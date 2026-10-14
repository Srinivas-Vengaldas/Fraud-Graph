"""Export the feature vectors the API logged during replay, and check coverage.

Reads the `features` table (written by the serving path, one row per scored
transaction) into data/clean/features.parquet. Training joins this file with a
few raw columns and the labels, so the model learns from exactly what the API
computed. Fails if any replayed training transaction has no feature row.

Usage:
  python ml/export_features.py
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "prep"))
from db import connect  # noqa: E402
from split import assign  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--parquet", default="data/clean/train.parquet")
    ap.add_argument("--splits", default="data/clean/splits.json")
    ap.add_argument("--out", default="data/clean/features.parquet")
    args = ap.parse_args()

    with connect() as conn:
        rows = conn.execute("SELECT transaction_id, features, model_version FROM features").fetchall()
        n_decisions = conn.execute("SELECT count(*) FROM decisions").fetchone()[0]
    feats = pd.DataFrame([{"TransactionID": tid, "feature_model_version": mv, **f} for tid, f, mv in rows])

    tx = pd.read_parquet(args.parquet, columns=["TransactionID", "TransactionDT"])
    tx["part"] = assign(tx.TransactionDT, json.loads(Path(args.splits).read_text()))
    merged = tx.merge(feats[["TransactionID", "feature_model_version"]], on="TransactionID", how="left")
    cov = merged.groupby("part").agg(rows=("TransactionID", "size"), with_features=("feature_model_version", "count"))
    print(cov.to_string())
    print("model_version of training feature rows:",
          merged.loc[merged.part == "train", "feature_model_version"].value_counts(dropna=False).to_dict())
    print(f"{len(feats):,} feature rows, {n_decisions:,} decisions")

    feats.to_parquet(args.out, index=False)
    print(f"wrote {args.out}")
    train = cov.loc["train"]
    if train.with_features < train.rows:
        sys.exit(f"{train.rows - train.with_features} training transactions have no logged features; replay the train split")


if __name__ == "__main__":
    main()
