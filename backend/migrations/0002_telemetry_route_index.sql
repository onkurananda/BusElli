-- Migration 0002: composite index on telemetry_raw(route_id, captured_at DESC)
--
-- Bug 2 fix:
--   The clustering query in TelemetryRepository.getRecentForRoute is:
--     WHERE route_id = $1 AND captured_at > NOW() - $2 * INTERVAL '1 second'
--   The existing index is only on (session_id, captured_at DESC), so this
--   query performs a full sequential scan of telemetry_raw on every clustering
--   refresh cycle.
--
--   At 10,000 concurrent commuters pinging every 10 s the ingest rate is
--   ~1,000 rows/sec.  Within the 120-second lookback window, the hypertable
--   can hold 120,000 rows.  A sequential scan of 120 K rows, repeated for
--   every Kafka message on every route, is catastrophically slow.
--
--   This migration adds a BRIN index (Block Range INdex) on captured_at first
--   (TimescaleDB partitions by time so BRIN skips irrelevant chunks at no
--   storage cost) plus a standard B-tree composite index on (route_id,
--   captured_at DESC) which satisfies the WHERE clause exactly.
--
--   PostGIS / TimescaleDB note:
--     telemetry_raw is a TimescaleDB hypertable partitioned by captured_at.
--     CREATE INDEX on the parent table automatically propagates to all chunks.
--
-- Run with: psql $DATABASE_URL -f 0002_telemetry_route_index.sql

BEGIN;

-- Primary fix: composite B-tree index supporting the clustering query predicate.
-- CONCURRENTLY avoids a full table lock in production.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_raw_route_time
  ON telemetry_raw (route_id, captured_at DESC);

-- Secondary: BRIN index on captured_at alone — allows TimescaleDB to skip
-- entire chunks (pages) outside the 120-second window before even touching
-- the B-tree index above.  Very low storage cost (~1 page per 128 blocks).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_raw_captured_at_brin
  ON telemetry_raw USING BRIN (captured_at);

COMMIT;
