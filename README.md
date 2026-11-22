# BusElli Monorepo
# See .bobrules for all project rules enforced across this codebase.

# =============================================================================
# Environment variable template — copy to .env.development and fill in values
# =============================================================================
# NODE_ENV=development
# PORT=3000
# DATABASE_URL=postgresql://buselli:buselli_dev_secret@localhost:5432/buselli_dev
# DATABASE_POOL_MIN=2
# DATABASE_POOL_MAX=20
# REDIS_URL=redis://localhost:6379
# KAFKA_BROKERS=localhost:9092
# KAFKA_TELEMETRY_TOPIC=telemetry.raw
# KAFKA_CROWD_TOPIC=crowd.tags
# JWT_SECRET=change-me-to-a-32-char-or-longer-secret
# JWT_EXPIRY=24h
# TELEMETRY_STALE_SECONDS=120
# CROWD_TAG_TTL_SECONDS=1200
# BUS_CLUSTER_TTL_SECONDS=300
# CONFIDENCE_DECAY_PER_SECOND=0.0017

## Package structure
```
buselli/
├── .bobrules                    ← Project rules (TypeScript, PostGIS, battery, tests)
├── package.json                 ← Monorepo root (npm workspaces + turbo)
├── turbo.json                   ← Turbo pipeline config
├── backend/                     ← Node.js/TypeScript API server
│   ├── src/
│   │   ├── index.ts             ← Entrypoint
│   │   ├── config/env.ts        ← Zod-validated env schema
│   │   ├── eta/
│   │   │   ├── types.ts         ← ETA types (branded ConfidenceScore, discriminated unions)
│   │   │   ├── eta-calculator.ts
│   │   │   └── eta-calculator.test.ts  ← 7 required test cases per .bobrules §5.2
│   │   ├── clustering/
│   │   │   ├── bus-clustering-engine.ts
│   │   │   └── bus-clustering-engine.test.ts  ← 7 required test cases per .bobrules §5.3
│   │   └── map-matching/
│   │       └── map-matching-engine.ts
│   ├── migrations/
│   │   └── 0001_initial_gtfs_schema.sql  ← PostGIS + TimescaleDB + all GIST indexes
│   ├── test/fixtures/           ← Spatial GeoJSON fixtures (no magic lat/lng inline)
│   ├── tsconfig.json            ← All strict flags per .bobrules §1.1
│   ├── vitest.config.ts         ← Coverage thresholds enforced per .bobrules §5.1
│   ├── Dockerfile
│   └── Dockerfile.dev
├── mobile/                      ← Flutter app
│   ├── lib/services/
│   │   ├── location_service.dart       ← Battery-efficient per .bobrules §4
│   │   ├── telemetry_queue_service.dart ← Batched offline flush per .bobrules §4.3
│   │   └── geofence_alarm_service.dart  ← 2-stop alarm per .bobrules §4.5
│   └── pubspec.yaml
├── gtfs-parser/                 ← TypeScript CLI: GTFS → SQLite mobile bundle
│   ├── src/schemas.ts           ← Zod schemas for all GTFS file formats
│   ├── test/schemas.test.ts
│   └── tsconfig.json
├── shared/                      ← Shared TypeScript types (WS messages, GeoPoint, etc.)
│   └── src/index.ts
└── docker/
    └── docker-compose.yml       ← PostGIS + TimescaleDB + Redis + Kafka + Backend
```
