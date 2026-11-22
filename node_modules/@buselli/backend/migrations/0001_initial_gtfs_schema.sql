-- BusElli Migration 0001 — Initial Schema
-- Extensions + PostGIS + TimescaleDB + Core GTFS Tables + Spatial Indexes
-- Follows .bobrules §3, §8

-- +migrate Up

-- ── Extensions ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── GTFS Static Tables ────────────────────────────────────────────────────────

CREATE TABLE agency (
  agency_id   TEXT PRIMARY KEY,
  agency_name TEXT NOT NULL,
  agency_url  TEXT NOT NULL,
  agency_timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata'
);

CREATE TABLE routes (
  route_id    TEXT PRIMARY KEY,
  agency_id   TEXT NOT NULL REFERENCES agency(agency_id),
  short_name  TEXT NOT NULL,
  long_name   TEXT NOT NULL,
  route_type  SMALLINT NOT NULL, -- 3 = bus
  color       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON routes (agency_id);
CREATE INDEX ON routes USING GIN (to_tsvector('english', short_name || ' ' || long_name));

CREATE TABLE stops (
  stop_id     TEXT PRIMARY KEY,
  stop_name   TEXT NOT NULL,
  stop_lat    DOUBLE PRECISION NOT NULL,
  stop_lon    DOUBLE PRECISION NOT NULL,
  -- PostGIS geometry — REQUIRED per .bobrules §3.1
  location    GEOMETRY(Point, 4326) GENERATED ALWAYS AS (
                ST_SetSRID(ST_MakePoint(stop_lon, stop_lat), 4326)
              ) STORED
);

-- REQUIRED GIST index per .bobrules §3.1
CREATE INDEX ON stops USING GIST (location);
CREATE INDEX ON stops USING GIN (to_tsvector('english', stop_name));

CREATE TABLE shapes (
  shape_id            TEXT NOT NULL,
  shape_pt_sequence   INT NOT NULL,
  shape_pt_lat        DOUBLE PRECISION NOT NULL,
  shape_pt_lon        DOUBLE PRECISION NOT NULL,
  shape_dist_traveled DOUBLE PRECISION,
  PRIMARY KEY (shape_id, shape_pt_sequence)
);

-- Pre-aggregated linestring per shape_id for fast map-matching
CREATE TABLE shape_lines (
  shape_id  TEXT PRIMARY KEY,
  geom      GEOMETRY(LineString, 4326) NOT NULL
);

-- REQUIRED GIST index per .bobrules §3.1
CREATE INDEX ON shape_lines USING GIST (geom);

CREATE TABLE calendar (
  service_id  TEXT PRIMARY KEY,
  monday      BOOLEAN NOT NULL,
  tuesday     BOOLEAN NOT NULL,
  wednesday   BOOLEAN NOT NULL,
  thursday    BOOLEAN NOT NULL,
  friday      BOOLEAN NOT NULL,
  saturday    BOOLEAN NOT NULL,
  sunday      BOOLEAN NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL
);

CREATE TABLE trips (
  trip_id      TEXT PRIMARY KEY,
  route_id     TEXT NOT NULL REFERENCES routes(route_id),
  service_id   TEXT NOT NULL REFERENCES calendar(service_id),
  shape_id     TEXT,
  direction_id SMALLINT NOT NULL DEFAULT 0,
  trip_headsign TEXT
);

CREATE INDEX ON trips (route_id);
CREATE INDEX ON trips (service_id);

CREATE TABLE stop_times (
  trip_id              TEXT NOT NULL REFERENCES trips(trip_id),
  stop_id              TEXT NOT NULL REFERENCES stops(stop_id),
  stop_sequence        INT NOT NULL,
  -- Stored as seconds since midnight; >86400 valid for post-midnight trips
  arrival_time_seconds INT NOT NULL,
  departure_time_seconds INT NOT NULL,
  shape_dist_traveled  DOUBLE PRECISION,
  PRIMARY KEY (trip_id, stop_sequence)
);

CREATE INDEX ON stop_times (stop_id, arrival_time_seconds);
CREATE INDEX ON stop_times (trip_id, stop_sequence);

-- ── Live State Tables ─────────────────────────────────────────────────────────

CREATE TABLE live_bus_positions (
  cluster_id          UUID NOT NULL DEFAULT uuid_generate_v4(),
  route_id            TEXT NOT NULL REFERENCES routes(route_id),
  trip_id             TEXT REFERENCES trips(trip_id),
  position            GEOMETRY(Point, 4326) NOT NULL,
  speed_kmh           DOUBLE PRECISION NOT NULL DEFAULT 0,
  nearest_stop_id     TEXT REFERENCES stops(stop_id),
  nearest_stop_seq    INT,
  confidence          DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  rider_count         INT NOT NULL DEFAULT 1,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- REQUIRED GIST index per .bobrules §3.1
CREATE INDEX ON live_bus_positions USING GIST (position);
CREATE INDEX ON live_bus_positions (route_id, updated_at DESC);

-- Convert to TimescaleDB hypertable per .bobrules §3.5
SELECT create_hypertable('live_bus_positions', 'updated_at',
  chunk_time_interval => INTERVAL '1 hour',
  if_not_exists => TRUE
);

-- Retention policy per .bobrules §3.5
SELECT add_retention_policy('live_bus_positions', INTERVAL '7 days', if_not_exists => TRUE);

-- ── Telemetry Raw ─────────────────────────────────────────────────────────────

CREATE TABLE telemetry_raw (
  id           UUID NOT NULL DEFAULT uuid_generate_v4(),
  session_id   UUID NOT NULL,
  -- user_id encrypted at rest per .bobrules §7
  user_id_enc  BYTEA NOT NULL, -- pgcrypto pgp_sym_encrypt(user_id::TEXT, key)
  route_id     TEXT NOT NULL REFERENCES routes(route_id),
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  accuracy_m   DOUBLE PRECISION NOT NULL,
  speed_kmh    DOUBLE PRECISION,
  cell_towers  JSONB, -- [{mcc, mnc, lac, cell_id, signal_strength}]
  captured_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX ON telemetry_raw (session_id, captured_at DESC);
-- Note: NO index on (lat, lng) — use PostGIS pattern via ST_MakePoint when needed

-- TimescaleDB hypertable per .bobrules §3.5
SELECT create_hypertable('telemetry_raw', 'captured_at',
  chunk_time_interval => INTERVAL '6 hours',
  if_not_exists => TRUE
);

SELECT add_retention_policy('telemetry_raw', INTERVAL '72 hours', if_not_exists => TRUE);

-- ── Crowd Tags ────────────────────────────────────────────────────────────────

CREATE TYPE crowd_tag_type AS ENUM (
  'seats_free', 'standing_only', 'packed', 'ac_ok', 'ac_broken'
);

CREATE TABLE crowd_tags (
  tag_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cluster_id     UUID NOT NULL,
  stop_id        TEXT REFERENCES stops(stop_id),
  tag_type       crowd_tag_type NOT NULL,
  reporter_id    UUID NOT NULL,
  trust_score    DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (trust_score BETWEEN 0 AND 1),
  reported_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Auto-expiry per .bobrules §3 and architecture spec (20-min TTL)
  expires_at     TIMESTAMPTZ NOT NULL GENERATED ALWAYS AS (reported_at + INTERVAL '20 minutes') STORED
);

CREATE INDEX ON crowd_tags (cluster_id, expires_at);
CREATE INDEX ON crowd_tags (stop_id, expires_at) WHERE expires_at > NOW();

-- ── User Karma ────────────────────────────────────────────────────────────────

CREATE TABLE user_karma (
  user_id       UUID PRIMARY KEY,
  karma_total   INT NOT NULL DEFAULT 0,
  reports_count INT NOT NULL DEFAULT 0,
  accuracy_rate DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  streak_days   INT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── User Consents (DPDP Act 2023) ────────────────────────────────────────────
-- Per .bobrules §7: telemetry must NOT be collected before consent row exists.

CREATE TABLE user_consents (
  user_id       UUID PRIMARY KEY,
  location_consent  BOOLEAN NOT NULL DEFAULT FALSE,
  analytics_consent BOOLEAN NOT NULL DEFAULT FALSE,
  consent_version   TEXT NOT NULL,
  consented_at      TIMESTAMPTZ NOT NULL,
  revoked_at        TIMESTAMPTZ
);

-- ── Cell-Tower LUT ────────────────────────────────────────────────────────────

CREATE TABLE cell_tower_lut (
  mcc         SMALLINT NOT NULL,
  mnc         SMALLINT NOT NULL,
  lac         INT NOT NULL,
  cell_id     BIGINT NOT NULL,
  location    GEOMETRY(Point, 4326) NOT NULL,
  accuracy_m  INT NOT NULL,
  samples     INT NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mcc, mnc, lac, cell_id)
);

-- REQUIRED GIST index per .bobrules §3.1
CREATE INDEX ON cell_tower_lut USING GIST (location);

-- ── Historical Speed Profiles ─────────────────────────────────────────────────

CREATE TABLE historical_speed_profiles (
  route_id      TEXT NOT NULL REFERENCES routes(route_id),
  hour_of_day   SMALLINT NOT NULL CHECK (hour_of_day BETWEEN 0 AND 23),
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun
  avg_speed_kmh DOUBLE PRECISION NOT NULL,
  sample_count  INT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (route_id, hour_of_day, day_of_week)
);

-- +migrate Down

SELECT remove_retention_policy('telemetry_raw', if_not_exists => TRUE);
SELECT remove_retention_policy('live_bus_positions', if_not_exists => TRUE);

DROP TABLE IF EXISTS historical_speed_profiles;
DROP TABLE IF EXISTS cell_tower_lut;
DROP TABLE IF EXISTS user_consents;
DROP TABLE IF EXISTS user_karma;
DROP TABLE IF EXISTS crowd_tags;
DROP TYPE  IF EXISTS crowd_tag_type;
DROP TABLE IF EXISTS telemetry_raw;
DROP TABLE IF EXISTS live_bus_positions;
DROP TABLE IF EXISTS stop_times;
DROP TABLE IF EXISTS trips;
DROP TABLE IF EXISTS calendar;
DROP TABLE IF EXISTS shape_lines;
DROP TABLE IF EXISTS shapes;
DROP TABLE IF EXISTS stops;
DROP TABLE IF EXISTS routes;
DROP TABLE IF EXISTS agency;
DROP EXTENSION IF EXISTS "uuid-ossp";
DROP EXTENSION IF EXISTS pgcrypto;
DROP EXTENSION IF EXISTS timescaledb;
DROP EXTENSION IF EXISTS postgis;
