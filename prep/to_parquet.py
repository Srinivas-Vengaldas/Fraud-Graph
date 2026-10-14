"""Join transactions with identity, sort by time, and write one Parquet file.

Left join on TransactionID (identity is optional). The output is sorted by
TransactionDT, then TransactionID, so every later stage can stream it in
event-time order.

Usage:
  python prep/to_parquet.py --raw-dir data/raw --out data/clean/train.parquet
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd


def build(raw_dir: Path) -> tuple[pd.DataFrame, int]:
    tx = pd.read_csv(raw_dir / "train_transaction.csv")
    ident = pd.read_csv(raw_dir / "train_identity.csv")
    n_csv = len(tx)
    df = tx.merge(ident, on="TransactionID", how="left", validate="one_to_one")
    df = df.sort_values(["TransactionDT", "TransactionID"], kind="stable").reset_index(drop=True)
    return df, n_csv


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw-dir", default="data/raw")
    ap.add_argument("--out", default="data/clean/train.parquet")
    args = ap.parse_args()
    df, n_csv = build(Path(args.raw_dir))
    assert len(df) == n_csv, f"row count changed in join: {n_csv} -> {len(df)}"
    assert df["TransactionDT"].is_monotonic_increasing, "output is not sorted by time"
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, index=False)
    # Later stages stamp their docs with where the data came from.
    out.with_name("source.txt").write_text(args.raw_dir + "\n")
    print(f"wrote {len(df):,} rows x {df.shape[1]} columns to {out} (CSV had {n_csv:,})")


if __name__ == "__main__":
    main()
