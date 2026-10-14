# Load test

Script: [`load/k6-score.js`](../load/k6-score.js) with bodies from [`load/make_bodies.py`](../load/make_bodies.py) (holdout rows, label removed, unique TransactionID and Idempotency-Key per request, so every call is a fresh decision with the full write path: Redis idempotency, rules, ring graph, ONNX model, and one PostgreSQL transaction for transaction + decision + features).

**Not yet run against a deployed host.** These numbers are from a local run; rerun against the cloud instance once it is up (Step 21) and add a row.

| Date | Where | Machine | Concurrency | Duration | Requests/s | p50 | p95 | p99 | Errors |
|---|---|---|---|---|---|---|---|---|---|
| 2026-10-13 | local, k6 in Docker → API on host | MacBook Pro, Apple M1, 8 cores, 8 GB; Postgres 16 + Redis 7 in Docker Desktop | 5 VUs | 30 s | 538 | 7.8 ms | 14.7 ms | 26.5 ms | 0% |
| 2026-10-13 | local, k6 in Docker → API on host | same | 20 VUs | 60 s | 651 | 25.0 ms | 59.3 ms | 96.4 ms | 0% |

Server-side scoring time (the `latency_ms` the API stores: blocklist, velocity, ring graph and model, excluding the database write) over the 55,192 load-test requests: p50 0.62 ms, p95 2.31 ms, p99 4.28 ms.

Reading: throughput levels off near 650 requests/s on this laptop and extra concurrency mostly adds queueing. Scoring itself takes a couple of milliseconds; the rest is the PostgreSQL write, two Redis round trips, and Docker Desktop networking. The API was the compiled build (`node dist/index.js`) with `LOG_LEVEL=warn`, single process.

Commands:

```
python load/make_bodies.py
docker run --rm -v "$PWD":/w -w /w -e BASE_URL=http://host.docker.internal:3000 \
  -e BODIES=/w/data/clean/k6_bodies.json -e VUS=20 -e DURATION=60s grafana/k6 run load/k6-score.js
psql "$DATABASE_URL" -f load/cleanup.sql   # remove load-test rows
```
