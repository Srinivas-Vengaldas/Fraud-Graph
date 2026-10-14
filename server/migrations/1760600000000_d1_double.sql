-- Up Migration
-- D1 feeds the card entity key (floor(TransactionDT / 86400 - D1)); keep it at full precision
-- so a warm start rebuilds exactly the keys the API computed from the request.
ALTER TABLE transactions ALTER COLUMN d1 TYPE DOUBLE PRECISION;

-- Down Migration
ALTER TABLE transactions ALTER COLUMN d1 TYPE REAL;
