/**
 * RedisClusterStore — stores live bus cluster state in Redis.
 *
 * Key schema (from .bobrules Redis key patterns):
 *   bus:pos:{clusterId}         HASH   TTL = BUS_CLUSTER_TTL_SECONDS
 *   route:buses:{routeId}       SET    TTL = BUS_CLUSTER_TTL_SECONDS
 *   stop:eta:{stopId}:{routeId} ZSET   TTL = 90s  (score = ETA epoch seconds)
 *
 * All writes go through this single class so TTLs are always applied consistently.
 *
 * Bug 4 fix — atomicReplaceRoute:
 *   The original flushRoute + N×putCluster sequence was NOT atomic.  A concurrent
 *   putCluster from another worker between the SMEMBERS read and the DEL pipeline
 *   would leave a ghost cluster ID in route:buses:{routeId} forever.
 *   atomicReplaceRoute uses a Lua script that runs entirely server-side in a single
 *   Redis round-trip: it DELs all old bus:pos hashes, DELs the route set, then
 *   writes all new hashes and rebuilds the set — all inside one EVAL call.
 *
 * Bug 7 fix — SET TTL:
 *   putCluster used to call EXPIRE on route:buses:{routeId} on every write, so
 *   writing 20 clusters in a loop reset the TTL 20 times.  atomicReplaceRoute sets
 *   the TTL exactly once after all members are added.
 */
import { makeConfidenceScore } from '../eta/types.js';
import type { Redis } from 'ioredis';
import type { LiveCluster } from './spatial-clustering-service.js';

/** Seconds before a cluster entry is automatically evicted. Per .bobrules §3. */
export const BUS_CLUSTER_TTL_SECONDS = 300;
export const STOP_ETA_TTL_SECONDS    = 90;

/**
 * Lua script for atomic route replacement (Bug 4 + Bug 7 fix).
 *
 * KEYS[1]  = route:buses:{routeId}  (the SET tracking cluster IDs)
 * ARGV[1]  = TTL in seconds (BUS_CLUSTER_TTL_SECONDS)
 * ARGV[2]  = JSON-encoded array of cluster objects to write
 *
 * The script:
 *   1. Reads the current member set (old cluster IDs).
 *   2. DELs every old bus:pos hash.
 *   3. DELs the route set itself.
 *   4. For each new cluster: HMSETs the hash and EXPIREs it.
 *   5. SADDs all new cluster IDs into the route set and EXPIREs it ONCE.
 */
const ATOMIC_REPLACE_LUA = `
local routeKey = KEYS[1]
local ttl      = tonumber(ARGV[1])
local clusters = cjson.decode(ARGV[2])

-- 1. Remove old cluster hashes
local oldIds = redis.call('SMEMBERS', routeKey)
for _, id in ipairs(oldIds) do
  redis.call('DEL', 'bus:pos:' .. id)
end

-- 2. Remove the route set
redis.call('DEL', routeKey)

-- 3. Write new cluster hashes and rebuild the set
for _, c in ipairs(clusters) do
  local posKey = 'bus:pos:' .. c.clusterId
  redis.call('HSET', posKey,
    'clusterId',    c.clusterId,
    'routeId',      c.routeId,
    'lat',          c.lat,
    'lng',          c.lng,
    'speedKmh',     c.speedKmh,
    'confidence',   c.confidence,
    'riderCount',   c.riderCount,
    'updatedAt',    c.updatedAt,
    'nearestStopId', c.nearestStopId
  )
  redis.call('EXPIRE', posKey, ttl)
  redis.call('SADD', routeKey, c.clusterId)
end

-- 4. Set TTL on the route set ONCE (Bug 7 fix)
if #clusters > 0 then
  redis.call('EXPIRE', routeKey, ttl)
end

return #clusters
`;

export class RedisClusterStore {
  constructor(private readonly redis: Redis) {}

  /**
   * Atomically replaces all clusters for a route in a single Lua EVAL.
   *
   * Replaces the former flushRoute + N×putCluster sequence.  Uses a Lua
   * script so the DEL-old / write-new sequence cannot be interleaved by
   * concurrent workers (Bug 4 fix).  The route SET TTL is set exactly once
   * after all members are added (Bug 7 fix).
   */
  async atomicReplaceRoute(routeId: string, clusters: readonly LiveCluster[]): Promise<void> {
    const routeKey = `route:buses:${routeId}`;
    const payload  = clusters.map((c) => ({
      clusterId:    c.clusterId,
      routeId:      c.routeId,
      lat:          String(c.lat),
      lng:          String(c.lng),
      speedKmh:     String(c.speedKmh),
      confidence:   String(c.confidence),
      riderCount:   String(c.riderCount),
      updatedAt:    c.updatedAt.toISOString(),
      nearestStopId: c.nearestStopId ?? '',
    }));
    await (this.redis as Redis & { eval: (...a: unknown[]) => Promise<unknown> }).eval(
      ATOMIC_REPLACE_LUA,
      1,
      routeKey,
      String(BUS_CLUSTER_TTL_SECONDS),
      JSON.stringify(payload),
    );
  }

  /**
   * Writes a single cluster to Redis (kept for ad-hoc / test use).
   * For production batch writes, prefer atomicReplaceRoute.
   *
   * Bug 7 partial note: this method still refreshes the route SET TTL on
   * every call.  Use atomicReplaceRoute when writing multiple clusters for
   * the same route to avoid the TTL-reset churn.
   */
  async putCluster(cluster: LiveCluster): Promise<void> {
    const posKey   = `bus:pos:${cluster.clusterId}`;
    const routeKey = `route:buses:${cluster.routeId}`;

    const pipeline = this.redis.pipeline();

    pipeline.hset(posKey, {
      clusterId:    cluster.clusterId,
      routeId:      cluster.routeId,
      lat:          String(cluster.lat),
      lng:          String(cluster.lng),
      speedKmh:     String(cluster.speedKmh),
      confidence:   String(cluster.confidence),
      riderCount:   String(cluster.riderCount),
      updatedAt:    cluster.updatedAt.toISOString(),
      nearestStopId: cluster.nearestStopId ?? '',
    });
    pipeline.expire(posKey, BUS_CLUSTER_TTL_SECONDS);

    pipeline.sadd(routeKey, cluster.clusterId);
    // Note: single-cluster write still refreshes the SET TTL once — acceptable.
    pipeline.expire(routeKey, BUS_CLUSTER_TTL_SECONDS);

    await pipeline.exec();
  }

  /**
   * Removes a cluster from Redis (called when it has gone stale on the backend).
   */
  async removeCluster(clusterId: string, routeId: string): Promise<void> {
    const pipeline = this.redis.pipeline();
    pipeline.del(`bus:pos:${clusterId}`);
    pipeline.srem(`route:buses:${routeId}`, clusterId);
    await pipeline.exec();
  }

  /**
   * Returns all active cluster IDs for a route.
   * Dead cluster IDs (TTL expired on hash but still in set) are cleaned up.
   */
  async getClusterIdsForRoute(routeId: string): Promise<string[]> {
    const ids = await this.redis.smembers(`route:buses:${routeId}`);
    if (ids.length === 0) return [];

    // Check which cluster hashes are still alive
    const pipeline = this.redis.pipeline();
    for (const id of ids) pipeline.exists(`bus:pos:${id}`);
    const results = await pipeline.exec();

    const liveIds: string[] = [];
    const deadIds: string[] = [];
    ids.forEach((id, i) => {
      const exists = results?.[i]?.[1];
      if (exists === 1) liveIds.push(id);
      else deadIds.push(id);
    });

    // Clean up dead IDs from the set
    if (deadIds.length > 0) {
      await this.redis.srem(`route:buses:${routeId}`, ...deadIds);
    }

    return liveIds;
  }

  /**
   * Fetches a single cluster by its ID.  Returns null if TTL has expired.
   */
  async getCluster(clusterId: string): Promise<LiveCluster | null> {
    const data = await this.redis.hgetall(`bus:pos:${clusterId}`);
    if (!data['clusterId']) return null;
    return deserialiseCluster(data);
  }

  /**
   * Returns all live clusters for a route.
   */
  async getClustersForRoute(routeId: string): Promise<LiveCluster[]> {
    const ids = await this.getClusterIdsForRoute(routeId);
    if (ids.length === 0) return [];

    const pipeline = this.redis.pipeline();
    for (const id of ids) pipeline.hgetall(`bus:pos:${id}`);
    const results = await pipeline.exec();

    const clusters: LiveCluster[] = [];
    for (const result of results ?? []) {
      const data = result?.[1] as Record<string, string> | null;
      if (data?.['clusterId']) {
        clusters.push(deserialiseCluster(data));
      }
    }
    return clusters;
  }

  /**
   * Writes an ETA prediction for a stop + route into a sorted set.
   * Score is the absolute epoch second when the bus is expected to arrive.
   */
  async putStopEta(
    stopId: string,
    routeId: string,
    clusterId: string,
    etaEpochSeconds: number,
  ): Promise<void> {
    const key = `stop:eta:${stopId}:${routeId}`;
    await this.redis
      .pipeline()
      .zadd(key, etaEpochSeconds, clusterId)
      .expire(key, STOP_ETA_TTL_SECONDS)
      .exec();
  }

  /**
   * Removes all data for a route (used in tests and manual admin operations).
   * Production code should use atomicReplaceRoute instead — it handles
   * flush + write atomically without a separate flushRoute call.
   */
  async flushRoute(routeId: string): Promise<void> {
    const ids = await this.redis.smembers(`route:buses:${routeId}`);
    const pipeline = this.redis.pipeline();
    for (const id of ids) pipeline.del(`bus:pos:${id}`);
    pipeline.del(`route:buses:${routeId}`);
    await pipeline.exec();
  }
}

function deserialiseCluster(data: Record<string, string>): LiveCluster {
  return {
    clusterId:    data['clusterId'] ?? '',
    routeId:      data['routeId']   ?? '',
    lat:          parseFloat(data['lat']        ?? '0'),
    lng:          parseFloat(data['lng']        ?? '0'),
    speedKmh:     parseFloat(data['speedKmh']   ?? '0'),
    confidence:   makeConfidenceScore(parseFloat(data['confidence'] ?? '0')),
    riderCount:   parseInt(data['riderCount']   ?? '1', 10),
    updatedAt:    new Date(data['updatedAt']    ?? new Date().toISOString()),
    nearestStopId: data['nearestStopId'] !== '' ? data['nearestStopId'] : undefined,
  };
}
