# 🚌 BusElli — Offline-First Crowdsourced BMTC Bus Tracking

> **Bengaluru's missing real-time transit layer.**  
> BusElli is a crowdsourced, offline-first bus tracking app for Bengaluru's 4+ million daily BMTC commuters — built on cell-tower triangulation, GTFS offline bundles, and a gamified crowd-reporting loop.

---

## Table of Contents

1. [What is BusElli?](#what-is-buselli)
2. [Quick Start — 3 Commands](#quick-start--3-commands)
3. [Getting a Free Google Maps API Key](#getting-a-free-google-maps-api-key)
4. [Running the Prototype](#running-the-prototype)
5. [Running the Backend](#running-the-backend)
6. [Running the Flutter Mobile App](#running-the-flutter-mobile-app)
7. [Running the GTFS Parser](#running-the-gtfs-parser)
8. [Running Tests](#running-tests)
9. [Environment Variables](#environment-variables)
10. [Docker Infrastructure](#docker-infrastructure)
11. [Database Migrations](#database-migrations)
12. [Project Structure](#project-structure)
13. [Architecture Overview](#architecture-overview)
14. [Google Maps Integration](#google-maps-integration)

---

## What is BusElli?

| Feature | How it works |
|---|---|
| **Offline-first GTFS** | Full BMTC route/stop timetable bundled as SQLite in the app — zero data needed for route lookup |
| **Live bus positions** | Crowdsourced GPS + cell-tower telemetry from onboard riders, clustered at 50 m radius |
| **Google Maps layer** | Live bus markers (crowd colour-coded) overlaid on a dark-theme Google Maps view |
| **Crowd + AC status** | Riders tap `Seats Free / Crowded / Packed` and `AC On/Off` — auto-expires after 20 min |
| **2-stop wake-up alarm** | Cell-tower geofence fires 2 stops before destination — works with no mobile data |
| **Karma points** | Gamified loop: share status → earn points → unlock leaderboard rank |

---

## Quick Start — 3 Commands

```bash
# 1. Clone & install
git clone https://github.com/your-org/buselli.git
cd buselli
npm install

# 2. Start all infrastructure (PostgreSQL/PostGIS, TimescaleDB, Redis, Kafka)
npm run docker:up

# 3. Start the backend in dev mode (hot-reload via tsx)
npm run dev
```

The backend API will be available at **http://localhost:3000**.

> **Prerequisites:** Node.js ≥ 20, npm ≥ 10, Docker Desktop (or Docker Engine + Compose).

---

## Getting a Free Google Maps API Key

BusElli's Map screen uses the **Maps JavaScript API** to render live bus markers on a real Bengaluru map.  
Google offers **$200 free credit per month** — enough for approximately **28,000 map loads/month** at no cost.

### Step-by-step (5 minutes)

1. Go to **[console.cloud.google.com](https://console.cloud.google.com)** and sign in with your Google account.

2. Click **"Select a project"** at the top → **"New Project"** → give it a name (e.g. `buselli-dev`) → **Create**.

3. In the left menu: **APIs & Services → Library**.

4. Search for **"Maps JavaScript API"** → click it → click **Enable**.

5. In the left menu: **APIs & Services → Credentials** → **+ Create Credentials → API Key**.

6. Copy the generated key (starts with `AIzaSy…`).

7. **Restrict your key** (recommended):
   - Under **Application restrictions** → select **HTTP referrers**.
   - Add `localhost/*` for local development.
   - Add your production domain when deploying.

8. **For the prototype**: open [`prototype.html`](prototype.html) in a browser → tap the **Map** screen → paste your key into the input field → tap **"Load Live Map"**.  
   The key is saved to `localStorage` and auto-reloaded on future visits.

9. **For the Flutter app**: add the key to [`mobile/.env`](#environment-variables) as `GOOGLE_MAPS_API_KEY=AIzaSy…` and to [`android/app/src/main/AndroidManifest.xml`](mobile/android/app/src/main/AndroidManifest.xml) per the `google_maps_flutter` plugin docs.

### Cost breakdown

| Usage | Monthly free quota |
|---|---|
| Map loads (web) | 28,000 loads free |
| Static Maps API | 100,000 requests free |
| Geocoding API | 40,000 requests free |
| Directions API | 40,000 requests free |

> No billing occurs unless you exceed the $200 free credit. Set a **Budget Alert** in Billing to be notified at $0 usage.

---

## Running the Prototype

The interactive prototype is a single self-contained HTML file — no build step needed.

```bash
# Option A: open directly in your browser
start buselli/prototype.html          # Windows
open  buselli/prototype.html          # macOS
xdg-open buselli/prototype.html       # Linux

# Option B: serve with any static file server
npx serve buselli --single
# then open http://localhost:3000
```

### What you'll see

| Screen | Description |
|---|---|
| **Home** | Search bar, Nearby Stops cards (walk distance + ETA), Recent Routes list |
| **Map** *(new)* | Google Maps live view — dark theme, bus markers (colour = crowd level), BMTC stop pins, route 500D polyline, your GPS location blue dot |
| **Live Route (500D)** | Vertical stop timeline with real-time bus icons between stops, crowd badges, AC status |
| **Alarms** | 2-stop wake-up alarm toggle for any stop, offline cell-tower geofence mode |

---

## Running the Backend

### Development (hot-reload)

```bash
cd buselli/backend
npm run dev
# → tsx watch src/index.ts
# → API available at http://localhost:3000
# → Logs: pino JSON output to stdout
```

### Production build

```bash
cd buselli/backend
npm run build        # tsc → dist/
npm run start        # node dist/index.js
```

### Key API endpoints (once running)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/telemetry` | Ingest a telemetry batch from a rider |
| `GET`  | `/api/v1/routes/:routeId/live` | Get live bus clusters for a route |
| `GET`  | `/api/v1/stops/:stopId/eta` | Get ETAs for all buses approaching a stop |
| `WS`   | `/ws/route/:routeId` | WebSocket stream of live bus position updates |

### Type-check without compiling

```bash
npm run typecheck
```

### Lint

```bash
npm run lint
```

---

## Running the Flutter Mobile App

### Prerequisites

- Flutter SDK ≥ 3.19 ([install](https://docs.flutter.dev/get-started/install))
- Android Studio or Xcode (for device/emulator)
- A physical Android device or emulator running API level 26+

```bash
cd buselli/mobile

# Install Flutter dependencies
flutter pub get

# Run code generators (Drift DB, Freezed models)
dart run build_runner build --delete-conflicting-outputs

# Run on a connected device or emulator
flutter run

# Run on a specific device
flutter devices          # list available devices
flutter run -d <device-id>

# Release build (Android APK)
flutter build apk --release

# Release build (Android App Bundle for Play Store)
flutter build appbundle --release
```

### Adding the Google Maps API key to the Flutter app

1. Open [`mobile/android/app/src/main/AndroidManifest.xml`](mobile/android/app/src/main/AndroidManifest.xml).

2. Inside `<application>`, add:
   ```xml
   <meta-data
     android:name="com.google.android.geo.API_KEY"
     android:value="AIzaSy…YOUR_KEY_HERE"/>
   ```

3. For iOS, open [`mobile/ios/Runner/AppDelegate.swift`](mobile/ios/Runner/AppDelegate.swift) and add:
   ```swift
   GMSServices.provideAPIKey("AIzaSy…YOUR_KEY_HERE")
   ```

4. Add `google_maps_flutter: ^2.5.3` to [`mobile/pubspec.yaml`](mobile/pubspec.yaml) under `dependencies`.

---

## Running the GTFS Parser

The GTFS parser is a TypeScript CLI that imports BMTC static schedule data (routes, stops, stop_times, shapes) from a GTFS ZIP into the PostgreSQL/PostGIS database and generates a SQLite bundle for the mobile app.

### Download BMTC GTFS data

BMTC does not publish an official open GTFS feed yet. Use one of:

- **OpenMobilityData / Transitland**: search for "BMTC Bangalore"
- **GTFS Exchange archive**: older but functional for prototyping
- **Mock data**: the parser ships with a fixture set at `gtfs-parser/test/fixtures/`

```bash
# Build the parser
cd buselli/gtfs-parser
npm run build

# Import a GTFS ZIP into PostGIS
npm run start -- --input /path/to/bmtc_gtfs.zip --db postgresql://buselli:buselli_dev_secret@localhost:5432/buselli_dev

# Or from monorepo root (builds then runs):
npm run gtfs:import -- --input /path/to/bmtc_gtfs.zip
```

The parser will:
1. Stream-parse `routes.txt`, `stops.txt`, `trips.txt`, `stop_times.txt`, `shapes.txt`
2. Validate every row against Zod schemas
3. UPSERT all data into PostGIS tables via UNNEST batch inserts
4. Build `ST_MakeLine` geometry for each shape
5. Output a summary: `Imported 450 routes, 12,000 stops, 2.1M stop_times`

---

## Running Tests

### Backend (Vitest — 68 tests)

```bash
# From monorepo root
npm run test

# From backend package (verbose output)
cd buselli/backend
npm run test -- --reporter=verbose

# With coverage (enforces thresholds: eta/ ≥95%, clustering/ ≥90%, global ≥80%)
npm run test:coverage

# Watch mode during development
npm run test:watch
```

### GTFS Parser (Vitest — 18 tests)

```bash
cd buselli/gtfs-parser
npm run test
```

### Flutter Mobile (40 tests declared)

```bash
cd buselli/mobile
flutter test

# Specific test file
flutter test test/db/app_database_test.dart
flutter test test/models/models_test.dart
flutter test test/services/beacon_service_test.dart
```

### All packages (Turbo parallel)

```bash
# From monorepo root
npm run test
# Turbo runs backend + gtfs-parser tests in parallel
```

---

## Environment Variables

Copy the template and fill in your values:

```bash
cp buselli/.env.example buselli/.env.development
```

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development` / `production` / `test` |
| `PORT` | `3000` | Fastify server port |
| `DATABASE_URL` | `postgresql://buselli:buselli_dev_secret@localhost:5432/buselli_dev` | PostgreSQL/PostGIS connection string |
| `DATABASE_POOL_MIN` | `2` | pg connection pool minimum |
| `DATABASE_POOL_MAX` | `20` | pg connection pool maximum |
| `REDIS_URL` | `redis://localhost:6379` | ioredis connection URL |
| `KAFKA_BROKERS` | `localhost:9092` | Comma-separated Kafka broker list |
| `KAFKA_TELEMETRY_TOPIC` | `telemetry.raw` | Topic for inbound rider telemetry |
| `KAFKA_CROWD_TOPIC` | `crowd.tags` | Topic for crowd status tag events |
| `JWT_SECRET` | *(required)* | ≥32-char secret for JWT signing |
| `JWT_EXPIRY` | `24h` | JWT token lifespan |
| `TELEMETRY_STALE_SECONDS` | `120` | Lookback window for clustering queries |
| `CROWD_TAG_TTL_SECONDS` | `1200` | 20-min crowd tag auto-expiry |
| `BUS_CLUSTER_TTL_SECONDS` | `300` | Redis cluster TTL (5 min) |
| `CONFIDENCE_DECAY_PER_SECOND` | `0.0017` | Confidence score decay rate |
| `GOOGLE_MAPS_API_KEY` | *(optional)* | For server-side geocoding / static maps |
| `TELEMETRY_ENCRYPTION_KEY` | *(required in prod)* | 32-char key for pgcrypto user_id encryption (DPDP Act 2023 §7) |

Create a `.env.development` file at the monorepo root:

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://buselli:buselli_dev_secret@localhost:5432/buselli_dev
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=20
REDIS_URL=redis://localhost:6379
KAFKA_BROKERS=localhost:9092
KAFKA_TELEMETRY_TOPIC=telemetry.raw
KAFKA_CROWD_TOPIC=crowd.tags
JWT_SECRET=change-me-to-a-32-char-or-longer-secret
JWT_EXPIRY=24h
TELEMETRY_STALE_SECONDS=120
CROWD_TAG_TTL_SECONDS=1200
BUS_CLUSTER_TTL_SECONDS=300
CONFIDENCE_DECAY_PER_SECOND=0.0017
```

---

## Docker Infrastructure

All backing services are defined in [`docker/docker-compose.yml`](docker/docker-compose.yml).

```bash
# Start all services (PostgreSQL, TimescaleDB, Redis, Kafka, Backend)
npm run docker:up
# or
docker compose -f docker/docker-compose.yml up -d

# Stop all services (preserves volumes)
npm run docker:down
# or
docker compose -f docker/docker-compose.yml down

# Stop and destroy all data volumes (full reset)
docker compose -f docker/docker-compose.yml down -v

# View logs
docker compose -f docker/docker-compose.yml logs -f backend
docker compose -f docker/docker-compose.yml logs -f postgres

# Check service health
docker compose -f docker/docker-compose.yml ps
```

### Services and ports

| Service | Image | Port | Purpose |
|---|---|---|---|
| `postgres` | `postgis/postgis:16-3.4` | `5432` | GTFS routes, stops, shapes (PostGIS spatial) |
| `timescaledb` | `timescale/timescaledb-ha:pg16-latest` | `5433` | `telemetry_raw` hypertable (time-series ingest) |
| `redis` | `redis:7.2-alpine` | `6379` | Live bus cluster state, ETA ZSET, crowd tags |
| `kafka` | `confluentinc/cp-kafka:7.6.0` | `9092` | Telemetry event streaming (KRaft mode, no Zookeeper) |
| `backend` | local Dockerfile.dev | `3000` | Fastify API + WebSocket server |

> **TimescaleDB note:** `telemetry_raw` is partitioned by `captured_at` using TimescaleDB hypertables. All queries against this table must include a time-range predicate (e.g. `WHERE captured_at > NOW() - INTERVAL '120 seconds'`) to benefit from chunk pruning.

---

## Database Migrations

Migrations live in [`backend/migrations/`](backend/migrations/) and are applied automatically when the `postgres` Docker service starts (via the `docker-entrypoint-initdb.d` volume mount).

To apply manually:

```bash
# Connect to the running postgres container
docker exec -it buselli_postgres psql -U buselli -d buselli_dev

# Apply a specific migration
docker exec -i buselli_postgres psql -U buselli -d buselli_dev \
  < backend/migrations/0001_initial_gtfs_schema.sql

docker exec -i buselli_postgres psql -U buselli -d buselli_dev \
  < backend/migrations/0002_telemetry_route_index.sql
```

### Migration index

| File | Description |
|---|---|
| [`0001_initial_gtfs_schema.sql`](backend/migrations/0001_initial_gtfs_schema.sql) | PostGIS extensions, GTFS tables (`routes`, `stops`, `stop_times`, `shapes`), `telemetry_raw` TimescaleDB hypertable, `crowd_tags` table, `user_consents` table. All GEOMETRY columns have GIST indexes. |
| [`0002_telemetry_route_index.sql`](backend/migrations/0002_telemetry_route_index.sql) | Composite B-tree index `(route_id, captured_at DESC)` on `telemetry_raw` — critical for clustering query performance at 10K concurrent commuters. Also adds a BRIN index on `captured_at` for TimescaleDB chunk pruning. |

---

## Project Structure

```
buselli/
├── .bobrules                        ← Project rules (TypeScript strict, PostGIS, battery, tests)
├── package.json                     ← Monorepo root (npm workspaces + turbo)
├── turbo.json                       ← Turbo pipeline (build → test → lint)
├── tsconfig.base.json               ← Shared TS base config (NodeNext ESM, all strict flags)
├── prototype.html                   ← Interactive 4-screen prototype (open in browser)
│
├── backend/                         ← Node.js/TypeScript API server (Fastify)
│   ├── src/
│   │   ├── index.ts                 ← Server entrypoint
│   │   ├── app.ts                   ← buildApp factory (Fastify plugins)
│   │   ├── config/env.ts            ← Zod-validated environment schema
│   │   ├── lib/logger.ts            ← pino ESM logger
│   │   ├── eta/
│   │   │   ├── types.ts             ← BusCluster, ConfidenceScore, EtaStatus (branded types)
│   │   │   ├── eta-calculator.ts    ← LIVE / DEGRADED / HISTORICAL_FALLBACK chain
│   │   │   └── eta-calculator.test.ts
│   │   ├── clustering/
│   │   │   ├── bus-clustering-engine.ts        ← 100m legacy DBSCAN
│   │   │   ├── bus-clustering-engine.test.ts
│   │   │   ├── spatial-clustering-service.ts   ← 50m DBSCAN + grid pre-filter + in-flight guard
│   │   │   ├── spatial-clustering-service.test.ts
│   │   │   └── redis-cluster-store.ts          ← Redis TTL ops + atomic Lua replace
│   │   ├── telemetry/
│   │   │   ├── telemetry-validator.ts          ← Zod + server rules
│   │   │   ├── telemetry-validator.test.ts
│   │   │   ├── telemetry-repository.ts         ← UNNEST batch insert, TimescaleDB query
│   │   │   ├── telemetry-ingest-service.ts     ← DPDP consent, persist, cluster refresh
│   │   │   ├── telemetry-ingest-service.test.ts
│   │   │   └── telemetry-kafka-consumer.ts     ← KafkaJS consumer → ingestBatch
│   │   └── map-matching/
│   │       └── map-matching-engine.ts          ← ST_ClosestPoint snap to GTFS shape
│   ├── migrations/
│   │   ├── 0001_initial_gtfs_schema.sql
│   │   └── 0002_telemetry_route_index.sql
│   ├── test/fixtures/               ← Shared test helpers (ETA fixtures, clustering fixtures)
│   ├── tsconfig.json
│   ├── vitest.config.ts             ← Per-module coverage thresholds
│   └── package.json
│
├── gtfs-parser/                     ← TypeScript CLI: GTFS ZIP → PostGIS + SQLite bundle
│   ├── src/
│   │   ├── schemas.ts               ← Zod schemas for GTFS file formats
│   │   ├── csv-reader.ts            ← Streaming CSV parser
│   │   ├── gtfs-repository.ts       ← UPSERT all GTFS tables + ST_MakeLine
│   │   ├── ingestion-pipeline.ts    ← FK-ordered orchestrator
│   │   ├── cli.ts                   ← CLI entrypoint (--input, --db flags)
│   │   └── index.ts                 ← Public exports
│   ├── test/
│   │   ├── schemas.test.ts
│   │   └── csv-reader.test.ts
│   └── package.json
│
├── shared/                          ← Shared TypeScript types
│   └── src/index.ts                 ← GeoPoint, WsMessage union, TelemetryPayload
│
├── mobile/                          ← Flutter app (iOS + Android)
│   ├── lib/
│   │   ├── main.dart                ← App entrypoint
│   │   ├── db/app_database.dart     ← Drift schema (GTFS offline SQLite + alarms)
│   │   ├── models/models.dart       ← LiveBus, BusStop, CrowdLevel, EtaResult
│   │   ├── providers/providers.dart ← Riverpod providers
│   │   ├── router/router.dart       ← go_router ShellRoute
│   │   ├── screens/
│   │   │   ├── home_screen.dart     ← Search + nearby + recent
│   │   │   ├── live_route_screen.dart ← Stop timeline + bus markers
│   │   │   ├── beacon_drawer.dart   ← "I'm on this bus" drawer
│   │   │   └── alarms_screen.dart   ← 2-stop alarm management
│   │   ├── services/
│   │   │   ├── beacon_service.dart  ← GPS + cell-tower + batch flush
│   │   │   ├── websocket_service.dart ← WS with exponential backoff reconnect
│   │   │   ├── geofence_alarm_service.dart ← 300m geofence + notifications
│   │   │   └── telemetry_queue_service.dart ← Offline queue flush
│   │   └── widgets/
│   │       ├── crowd_badge.dart     ← CrowdBadge + CrowdStatusTag
│   │       ├── bus_marker.dart      ← Bus icon + AC + confidence ring
│   │       └── offline_badge.dart   ← Animated pulsing offline indicator
│   ├── test/
│   │   ├── db/app_database_test.dart
│   │   ├── models/models_test.dart
│   │   └── services/beacon_service_test.dart
│   └── pubspec.yaml
│
└── docker/
    └── docker-compose.yml           ← PostGIS + TimescaleDB + Redis + Kafka + Backend
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  Flutter App (iOS / Android)                                        │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  HomeScreen  │  │ LiveRoute    │  │  MapScreen               │  │
│  │  Nearby stops│  │ Stop timeline│  │  Google Maps JS API      │  │
│  │  Route search│  │ Bus markers  │  │  Live bus markers        │  │
│  └──────────────┘  └──────────────┘  │  Crowd colour-coding     │  │
│                                      │  Route 500D polyline     │  │
│  ┌──────────────┐  ┌──────────────┐  └──────────────────────────┘  │
│  │ BeaconDrawer │  │ AlarmScreen  │                                 │
│  │ GPS + cell   │  │ 2-stop alarm │                                 │
│  │ tower report │  │ geofence     │                                 │
│  └──────┬───────┘  └──────────────┘                                │
│         │ HTTPS batch (≥10 pts or 5 min)                           │
└─────────┼───────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Fastify API  (Node.js / TypeScript)   port 3000                    │
│                                                                     │
│  POST /api/v1/telemetry  →  TelemetryIngestService                  │
│    1. Zod validate + DPDP consent check                             │
│    2. UNNEST batch insert → TimescaleDB (telemetry_raw)             │
│    3. Promise.all → refreshForRoute(routeId) per unique route       │
│         ↓ in-flight guard (coalesces concurrent callers)            │
│    4. DBSCAN 50m (grid pre-filter) → LiveCluster[]                  │
│    5. Lua EVAL → atomicReplaceRoute (Redis)                         │
│    6. WS broadcast → connected map clients                          │
│                                                                     │
│  GET  /api/v1/stops/:stopId/eta                                     │
│    → Redis ZSET stop:eta:{stopId}:{routeId}                         │
│    → EtaCalculator: LIVE → DEGRADED → HISTORICAL_FALLBACK           │
│                                                                     │
│  WS   /ws/route/:routeId                                            │
│    → push BusPositionUpdate on every cluster refresh                │
└───────────┬─────────────────────────────────────────────────────────┘
            │
     ┌──────┴──────────────────────────────────┐
     │                                          │
     ▼                                          ▼
┌──────────────────┐                 ┌──────────────────────────────┐
│  PostgreSQL 16   │                 │  Redis 7.2                   │
│  + PostGIS 3.4   │                 │                              │
│                  │                 │  bus:pos:{clusterId}  HASH   │
│  routes          │                 │  route:buses:{routeId} SET   │
│  stops           │                 │  stop:eta:{stopId}:{routeId} │
│  stop_times      │                 │  ZSET                        │
│  shapes          │                 │                              │
│  (GIST indexes)  │                 │  All TTLs: 300s / 90s        │
│                  │                 └──────────────────────────────┘
│  TimescaleDB:    │
│  telemetry_raw   │                 ┌──────────────────────────────┐
│  (hypertable)    │                 │  Kafka (KRaft)               │
│  crowd_tags      │                 │                              │
│  user_consents   │◄────────────────│  telemetry.raw topic         │
└──────────────────┘                 │  crowd.tags topic            │
                                     └──────────────────────────────┘
```

---

## Google Maps Integration

BusElli integrates the **Maps JavaScript API** for the prototype's Map screen and the **`google_maps_flutter`** plugin for the mobile app.

### What the map shows

| Element | Colour / Icon | Source |
|---|---|---|
| Live bus position | Arrow icon coloured by crowd level | Crowdsourced telemetry clusters from Redis |
| BMTC bus stops | Blue circle `●` | GTFS `stops.txt` |
| Route 500D path | Blue polyline | GTFS `shapes.txt` → PostGIS `ST_MakeLine` |
| Your GPS location | Blue filled circle | `navigator.geolocation` / `Geolocator` |

### Crowd colour legend on map

| Colour | Meaning |
|---|---|
| 🟢 Green | Seats Available |
| 🟡 Yellow | Standing Only |
| 🔴 Red | Packed — hard to board |

### Clicking a bus marker shows

- Route number + bus label
- Crowd status
- AC on / off
- Confidence score (% of riders confirming this cluster)

### Production integration checklist

- [ ] Enable **Maps JavaScript API** in Google Cloud Console
- [ ] Enable **Maps SDK for Android** and **Maps SDK for iOS** (for Flutter)
- [ ] Restrict your API key to your app's SHA-1 certificate fingerprint (Android) or bundle ID (iOS)
- [ ] Set a **Budget Alert** at $1 to catch unexpected usage spikes
- [ ] Store the key in environment variables — never commit it to git

---

## Code Quality & Rules

All project rules are enforced via [`.bobrules`](.bobrules). Key constraints:

- **TypeScript**: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` — no exceptions
- **PostGIS**: every `GEOMETRY` column must have a `GIST` index
- **TimescaleDB**: all queries on `telemetry_raw` must include a time-range predicate
- **Battery**: Flutter `LocationAccuracy.balanced` or lower — `bestForNavigation` is banned
- **Telemetry flush**: batch ≥10 points OR 5 min OR app-to-foreground — never per GPS fix
- **Geofence alarm**: max 2 active fences, 300m radius
- **Coverage thresholds**: `eta/` ≥95%, `clustering/` ≥90%, global ≥80%
- **DPDP Act 2023**: explicit consent check before any telemetry storage; `user_id` encrypted with `pgcrypto`

---

*Made with [IBM Bob](https://www.ibm.com/products/watsonx-code-assistant)*
