-- Up Migration

-- Raw fields the engine uses. isFraud is never stored here: the API never sees labels.
CREATE TABLE transactions (
  transaction_id  BIGINT PRIMARY KEY,
  transaction_dt  BIGINT NOT NULL,
  amount          NUMERIC(12, 3) NOT NULL,
  product_cd      TEXT,
  card1           INTEGER,
  card2           INTEGER,
  card3           INTEGER,
  card4           TEXT,
  card5           INTEGER,
  card6           TEXT,
  addr1           INTEGER,
  addr2           INTEGER,
  p_emaildomain   TEXT,
  r_emaildomain   TEXT,
  d1              REAL,
  device_type     TEXT,
  device_info     TEXT,
  id_30           TEXT,
  id_31           TEXT,
  id_33           TEXT,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX transactions_dt_idx ON transactions (transaction_dt);

CREATE TABLE decisions (
  transaction_id  BIGINT PRIMARY KEY REFERENCES transactions (transaction_id),
  verdict         TEXT NOT NULL CHECK (verdict IN ('approve', 'review', 'decline')),
  score           REAL,
  reasons         JSONB NOT NULL DEFAULT '[]'::jsonb,
  latency_ms      REAL NOT NULL,
  model_version   TEXT NOT NULL,
  decided_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX decisions_verdict_idx ON decisions (verdict);

-- The exact feature vector the serving path used, so training reads what serving computed.
CREATE TABLE features (
  transaction_id  BIGINT PRIMARY KEY REFERENCES transactions (transaction_id),
  features        JSONB NOT NULL,
  model_version   TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE blocklist (
  id              BIGSERIAL PRIMARY KEY,
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('card', 'device')),
  entity_key      TEXT NOT NULL,
  reason          TEXT NOT NULL,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_key)
);

-- Idempotency keys live in Redis only (atomic SET NX with a TTL); see src/api/idempotency.ts.

-- Down Migration
DROP TABLE blocklist;
DROP TABLE features;
DROP TABLE decisions;
DROP TABLE transactions;
