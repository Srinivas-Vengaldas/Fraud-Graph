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
	docker compose exec -T db psql -U $${PG_USER:-fraudgraph} -d $${PG_DB:-fraudgraph} -c "TRUNCATE features, decisions, transactions"
	docker compose exec -T redis redis-cli FLUSHDB

entities:        ## entity-key validation table + parity fixture
	$(PY) prep/entity_check.py
	$(PY) prep/entities.py
