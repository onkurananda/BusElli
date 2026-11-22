/**
 * RedisClusterStore — stores live bus cluster state in Redis.
 *
 * Key schema (from .bobrules Redis key patterns):
 *   bus:pos:{clusterId}         HASH   TTL = BUS_CLUSTER_TTL_SECONDS
 *   route:buses:{routeId}       SET    TTL = BUS_CLUSTER_TTL_SECONDS
 *   stop:eta:{stopId}:{routeId} ZSET   TTL = 90s  (score = ETA epoch seconds)
 *
 * All writes go through this single class so TTLs are always applied consistently.
 */
import type { Redis } from 'ioredis';
import type { LiveCluster } from './spatial-clustering-service.js';

/** Seconds before a cluster entry is automatically evicted. Per .bobrules §3. */
export const BUS_CLUSTER_TTL_SECONDS = 300;
export const STOP_ETA_TTL_SECONDS    = 90;

export class RedisClusterStore {
  constructor(private readonly redis: Redis) {}

  /**
   * Writes a cluster to Redis.
   * Sets bus:pos:{clusterId} as a HASH and adds the clusterId to
   * route:buses:{routeId} SET.  Both keys get refreshed TTLs.
   */
  async putCluster(cluster: LiveCluster): Promise<void> {
    const posKey   = `bus:pos:${cluster.clusterId}`;
    const routeKey = `route:buses:${cluster.routeId}`;

    const pipeline = this.redis.pipeline();

    pipeline.hset(posKey, {
      clusterId:   cluster.clusterId,
      routeId:     cluster.routeId,
      lat:         String(cluster.lat),
      lng:         String(cluster.lng),
      speedKmh:    String(cluster.speedKmh),
      confidence:  String(cluster.confidence),
      riderCount:  String(cluster.riderCount),
      updatedAt:   cluster.updatedAt.toISOString(),
      nearestStopId: cluster.nearestStopId ?? '',
    });
    pipeline.expire(posKey, BUS_CLUSTER_TTL_SECONDS);

    pipeline.sadd(routeKey, cluster.clusterId);
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

  /** Removes all data for a route (used in tests and re-ingest). */
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
    confidence:   parseFloat(data['confidence'] ?? '0'),
    riderCount:   parseInt(data['riderCount']   ?? '1', 10),
    updatedAt:    new Date(data['updatedAt']    ?? new Date().toISOString()),
    nearestStopId: data['nearestStopId'] !== '' ? data['nearestStopId'] : undefined,
  };
}
