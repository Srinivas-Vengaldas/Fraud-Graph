"""Write realistic request bodies for the k6 load test: holdout rows with the
API's fields only (no label). k6 replaces TransactionID with a unique id per
request so every call is a fresh decision, not an idempotent replay.

Usage:
  python load/make_bodies.py --n 2000 --out data/clean/k6_bodies.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "replay"))
sys.path.insert(0, str(ROOT / "prep"))
from replay import API_FIELDS, to_body  # noqa: E402
from split import assign  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--parquet", default="data/clean/train.parquet")
    ap.add_argument("--n", type=int, default=2000)
    ap.add_argument("--out", default="data/clean/k6_bodies.json")
    args = ap.parse_args()
    df = pd.read_parquet(ROOT / args.parquet)
    df = df[assign(df.TransactionDT, json.loads((ROOT / "data/clean/splits.json").read_text())) == "holdout"]
    df = df[[c for c in API_FIELDS if c in df.columns]].sample(n=min(args.n, len(df)), random_state=1)
    bodies = [to_body(r) for r in df.to_dict("records")]
    Path(ROOT / args.out).write_text(json.dumps(bodies))
    print(f"wrote {len(bodies)} bodies to {args.out}")


if __name__ == "__main__":
    main()
