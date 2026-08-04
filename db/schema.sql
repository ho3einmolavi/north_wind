-- Northwind paid-event slice schema.
-- NOTE: the app boots with TypeORM-style synchronize semantics in dev, but we
-- keep this canonical DDL so Postgres comes up already-shaped for the seed.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'guest',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auth lives in its own table/module on purpose (see auth module).
CREATE TABLE IF NOT EXISTS auth_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  token       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id       UUID NOT NULL REFERENCES users(id),
  title         TEXT NOT NULL,
  price_cents   INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'usd',
  status        TEXT NOT NULL DEFAULT 'open',  -- open | completed | cancelled
  attendee_count INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendances (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(id),
  guest_id    UUID NOT NULL REFERENCES users(id),
  checked_in  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A payment IS the money record. Its lifecycle is a single mutable status string.
--   pending -> held -> released -> paid_out
--                   -> refunded
CREATE TABLE IF NOT EXISTS payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events(id),
  guest_id        UUID NOT NULL REFERENCES users(id),
  host_id         UUID NOT NULL REFERENCES users(id),
  amount_cents    INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'usd',
  status          TEXT NOT NULL DEFAULT 'pending',
  provider_charge_id TEXT,
  idempotency_key TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_event ON payments(event_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- Worker-maintained projection of attendee_count -> event aggregate.
CREATE TABLE IF NOT EXISTS attendee_count_events (
  id          BIGSERIAL PRIMARY KEY,
  event_id    UUID NOT NULL,
  delta       INTEGER NOT NULL,
  processed   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transactional outbox for domain events (relayed after commit).
CREATE TABLE IF NOT EXISTS outbox (
  id          BIGSERIAL PRIMARY KEY,
  topic       TEXT NOT NULL,
  payload     JSONB NOT NULL,
  published   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
