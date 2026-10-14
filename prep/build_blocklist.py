"""Load the blocklist: entities with confirmed fraud in the training period.

Stands in for a chargeback blocklist. Each entry applies from
first fraud time + label delay (event time), so a replay never uses a label
before it would have existed.

  card entities   -> decline on hit
  device entities -> review on hit; generic devices (linked to more than
                     --degree-cap card entities in training) are skipped

Only rows whose reason starts with "training:" are replaced; analyst labels stay.

Usage:
  python prep/build_blocklist.py --label-delay-days 7
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from db import connect
from entities import add_entity_columns
from split import DAY, assign


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--parquet", default="data/clean/train.parquet")
    ap.add_argument("--splits", default="data/clean/splits.json")
    ap.add_argument("--label-delay-days", type=float, default=7)
    ap.add_argument("--degree-cap", type=int, default=50)
    args = ap.parse_args()

    df = pd.read_parquet(args.parquet, columns=["TransactionID", "TransactionDT", "isFraud", "card1", "addr1", "D1",
                                                "DeviceInfo", "id_30", "id_31", "id_33"])
    df = add_entity_columns(df)
    train = df[assign(df["TransactionDT"], json.loads(Path(args.splits).read_text())) == "train"]
    fraud = train[train.isFraud == 1]
    delay = int(args.label_delay_days * DAY)

    cards = fraud.groupby("card_entity")["TransactionDT"].min()
    degree = train.dropna(subset=["device_entity"]).groupby("device_entity")["card_entity"].nunique()
    fdev = fraud.dropna(subset=["device_entity"]).groupby("device_entity")["TransactionDT"].min()
    generic = set(degree[degree > args.degree_cap].index)
    devices = fdev[~fdev.index.isin(generic)]

    rows = [("card", k, "training: confirmed fraud in training period", int(t) + delay) for k, t in cards.items()]
    rows += [("device", k, "training: device used in confirmed fraud", int(t) + delay) for k, t in devices.items()]
    with connect() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM blocklist WHERE reason LIKE 'training:%'")
        cur.executemany(
            "INSERT INTO blocklist (entity_type, entity_key, reason, effective_dt) VALUES (%s, %s, %s, %s) "
            "ON CONFLICT (entity_type, entity_key) DO NOTHING",
            rows,
        )
    print(f"blocklist: {len(cards):,} card entities, {len(devices):,} device entities "
          f"({len(generic & set(fdev.index))} generic devices skipped), label delay {args.label_delay_days} days")


if __name__ == "__main__":
    main()
