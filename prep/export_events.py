"""Write data/clean/events.jsonl: one line per transaction in time order with
entity keys, split part and label, for offline evaluations that reuse the
TypeScript graph code (server/scripts/ringEval.ts).

Usage:
  python prep/export_events.py
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from entities import add_entity_columns
from split import assign


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--parquet", default="data/clean/train.parquet")
    ap.add_argument("--splits", default="data/clean/splits.json")
    ap.add_argument("--out", default="data/clean/events.jsonl")
    args = ap.parse_args()

    df = pd.read_parquet(args.parquet, columns=["TransactionID", "TransactionDT", "TransactionAmt", "isFraud", "card1",
                                                "addr1", "D1", "DeviceInfo", "id_30", "id_31", "id_33"])
    df = add_entity_columns(df)
    df["part"] = assign(df["TransactionDT"], json.loads(Path(args.splits).read_text()))
    with open(args.out, "w") as f:
        for r in df[["TransactionID", "TransactionDT", "TransactionAmt", "isFraud", "part",
                     "card_entity", "device_entity"]].itertuples(index=False):
            f.write(json.dumps({"id": int(r.TransactionID), "t": int(r.TransactionDT), "amt": float(r.TransactionAmt),
                                "y": int(r.isFraud), "part": r.part, "card": r.card_entity,
                                "device": r.device_entity if isinstance(r.device_entity, str) else None}) + "\n")
    print(f"wrote {len(df):,} events to {args.out}")


if __name__ == "__main__":
    main()
