PY ?= .venv/bin/python
RAW ?= $(if $(wildcard data/raw/train_transaction.csv),data/raw,data/raw-sample)

.PHONY: venv data sample profile parquet

venv:
	python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

data:            ## real IEEE-CIS data (needs ~/.kaggle/kaggle.json)
	./prep/download.sh

sample:          ## synthetic stand-in with the same columns
	$(PY) prep/make_sample.py --out data/raw-sample

profile:
	$(PY) prep/profile_data.py --raw-dir $(RAW) --out $(if $(filter data/raw,$(RAW)),docs/data_profile.md,docs/data_profile_sample.md)

parquet:
	$(PY) prep/to_parquet.py --raw-dir $(RAW) --out data/clean/train.parquet

split:
	$(PY) prep/split.py

test-py:
	$(PY) -m pytest -q tests/python

migrate:
	cd server && npm run migrate

api:
	cd server && npx tsx src/index.ts

replay-day:      ## replay one day (DAY=1) end to end
	$(PY) replay/replay.py --start-day $(or $(DAY),1) --end-day $$(( $(or $(DAY),1) + 1 ))

reset-state:     ## wipe decisions and idempotency keys (keeps schema and blocklist)
	docker compose exec -T db psql -U $${PG_USER:-fraudgraph} -d $${PG_DB:-fraudgraph} -c "TRUNCATE reviews, features, decisions, transactions"
	docker compose exec -T redis redis-cli FLUSHDB

entities:        ## entity-key validation table + parity fixture
	$(PY) prep/entity_check.py
	$(PY) prep/entities.py

events:
	$(PY) prep/export_events.py

rings: events     ## ring lift with and without the supernode cap -> docs/results.md
	cd server && npx tsx scripts/ringEval.ts

blocklist:
	$(PY) prep/build_blocklist.py

replay-all:      ## train, gap, holdout in time order (API must be running)
	$(PY) replay/replay.py --split train
	$(PY) replay/replay.py --split gap
	$(PY) replay/replay.py --split holdout

baseline:        ## rules-only holdout metrics from stored decisions -> docs/results.md
	$(PY) ml/evaluate_decisions.py --part holdout --section baseline --title "Rules-only baseline"

features:        ## export logged serving features (after replay-all)
	$(PY) ml/export_features.py

train:           ## LightGBM on the training period (early stop on its last 15%)
	$(PY) ml/train.py

evaluate:        ## holdout PR-AUC, recall at 1% FPR, top-k precision -> docs/results.md
	$(PY) ml/evaluate.py

costs:           ## cost-based thresholds, cost curve chart -> docs/results.md and README
	$(PY) ml/costs.py

onnx:            ## export ONNX + refresh the Node parity fixture
	$(PY) ml/export_onnx.py
	cd server && npx vitest run test/modelParity.test.ts && npx tsx scripts/benchModel.ts ../ml/artifacts

lift:            ## rules vs model vs both at equal review volume (after replay-all with the model) -> README
	$(PY) ml/lift.py
	$(PY) ml/evaluate_decisions.py --part holdout --section deployed --title "Deployed policy (rules + model) from API decisions"

web:             ## analyst UI dev server on :5173 (proxies the API on :3000)
	cd web && npx vite
