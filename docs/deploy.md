# Deploy

The whole system is one `docker compose` stack: PostgreSQL 16, Redis 7, and the API image (which also serves the analyst UI at `/`). Any single small Linux host with Docker works, as does a platform with managed Postgres and Redis (point `DATABASE_URL` and `REDIS_URL` at them and run only the `api` image).

**Status: not deployed yet.** Creating a cloud host costs money and needs your account, so it is left for you to start. Before you do, check the provider's current free-tier limits and set a billing alarm.

## Single host

```
git clone <your repo> fraudgraph && cd fraudgraph
cp .env.example .env            # set PG_PASSWORD (long random), keep the rest
# Optional: copy a trained model so the API scores with it (otherwise rules only)
scp ml/artifacts/{model.onnx,feature_spec.json,thresholds.json,train_meta.json} host:fraudgraph/ml/artifacts/
docker compose up -d --build    # migrations run on API start
curl http://<host>:3000/healthz # {"ok":true}
```

Open `http://<host>:3000/` for the review queue and ring explorer. Put a reverse proxy with TLS (Caddy or nginx) in front before sharing the link, and do not expose ports 5432 and 6379 publicly (remove their `ports:` lines in `docker-compose.yml` on the host).

## Demo data

Load a pre-replayed subset so the dashboard is useful immediately. From a machine with the data and the Python environment:

```
python prep/build_blocklist.py                       # with DATABASE_URL pointing at the host's Postgres (e.g. through an SSH tunnel)
python replay/replay.py --url http://<host>:3000 --split train --concurrency 4   # builds history the rings need
python replay/replay.py --url http://<host>:3000 --split holdout --end-day <cutoff_day + 7>
```

`make demo-seed URL=http://<host>:3000` runs the last two replays. One week of holdout decisions gives a full review queue; the training replay gives the ring graph its history. Restarts are safe: the API rebuilds velocity windows and the ring graph from stored transactions on startup.

## Load test against the host

```
make load BASE_URL=http://<host>:3000 VUS=20 DURATION=60s
```

Add the result, the date and the instance type to [docs/load.md](load.md).

## CI

`.github/workflows/ci.yml` runs on every push: Python unit tests and the entity-key parity check, server migrations from scratch, typecheck, all server tests including the Bloom-filter false-positive test, the 1,000-row entity-key parity test and the 1,000-row ONNX parity test, the web build, and the Docker image build.
