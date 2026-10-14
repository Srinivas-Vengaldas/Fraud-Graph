-- Remove rows written by the k6 load test (TransactionID >= 8,000,000,000).
DELETE FROM reviews WHERE transaction_id >= 8000000000;
DELETE FROM features WHERE transaction_id >= 8000000000;
DELETE FROM decisions WHERE transaction_id >= 8000000000;
DELETE FROM transactions WHERE transaction_id >= 8000000000;
