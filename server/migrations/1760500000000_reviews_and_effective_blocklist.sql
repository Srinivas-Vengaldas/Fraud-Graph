-- Up Migration

-- Event time (TransactionDT seconds) from which a blocklist entry may be used.
-- A chargeback is only known some time after the fraud, so an entry must not
-- flag transactions that happened before its label existed. NULL = always.
ALTER TABLE blocklist ADD COLUMN effective_dt BIGINT;

CREATE TABLE reviews (
  transaction_id  BIGINT PRIMARY KEY REFERENCES transactions (transaction_id),
  score           REAL NOT NULL,
  reasons         JSONB NOT NULL,
  card_entity     TEXT NOT NULL,
  device_entity   TEXT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fraud', 'legit')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  labeled_at      TIMESTAMPTZ
);
CREATE INDEX reviews_open_idx ON reviews (status) WHERE status = 'open';

-- Down Migration
DROP TABLE reviews;
ALTER TABLE blocklist DROP COLUMN effective_dt;
