"""Stream transactions to the scoring API in event-time order.

Each row is POSTed to /v1/score with Idempotency-Key = TransactionID, so a rerun
returns stored decisions instead of creating new ones. isFraud is never sent.

Usage:
  python replay/replay.py --start-day 1 --end-day 2
  python replay/replay.py --split train --concurrency 4
  python replay/replay.py --split holdout --rps 200

Concurrency above 1 lets requests overlap, which can reorder events that are
milliseconds apart. Velocity windows use event time, so counts stay correct,
but use --concurrency 1 when a run must be exactly reproducible.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd
import requests

DAY = 86_400

# Exactly the fields the API schema accepts (see server/src/api/schemas.ts).
API_FIELDS = [
    "TransactionID", "TransactionDT", "TransactionAmt", "ProductCD",
    "card1", "card2", "card3", "card4", "card5", "card6", "addr1", "addr2",
    "P_emaildomain", "R_emaildomain", "C1", "C2", "C13", "C14",
    "D1", "D2", "D4", "D10", "D15",
    "DeviceType", "DeviceInfo", "id_30", "id_31", "id_33",
]
assert "isFraud" not in API_FIELDS


def load(parquet: str, start_day: float | None, end_day: float | None, limit: int | None) -> pd.DataFrame:
    df = pd.read_parquet(parquet)
    cols = [c for c in API_FIELDS if c in df.columns]
    day = df["TransactionDT"] // DAY
    mask = pd.Series(True, index=df.index)
    if start_day is not None:
        mask &= day >= start_day
    if end_day is not None:
        mask &= day < end_day
    df = df.loc[mask, cols].sort_values(["TransactionDT", "TransactionID"], kind="stable")
    return df.head(limit) if limit else df


def to_body(row: dict) -> dict:
    body = {}
    for k, v in row.items():
        if v is None or (isinstance(v, float) and math.isnan(v)):
            body[k] = None
        elif k in ("TransactionID", "TransactionDT"):
            body[k] = int(v)
        elif hasattr(v, "item"):
            body[k] = v.item()
        else:
            body[k] = v
    return body


class Pacer:
    """Simple global rate limiter shared by all worker threads."""

    def __init__(self, rps: float | None):
        self.interval = 1.0 / rps if rps else 0.0
        self.next_at = time.perf_counter()
        self.lock = threading.Lock()

    def wait(self) -> None:
        if not self.interval:
            return
        with self.lock:
            now = time.perf_counter()
            at = max(self.next_at, now)
            self.next_at = at + self.interval
        delay = at - time.perf_counter()
        if delay > 0:
            time.sleep(delay)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:3000")
    ap.add_argument("--parquet", default="data/clean/train.parquet")
    ap.add_argument("--split", choices=["train", "holdout", "gap"], help="use day bounds from data/clean/splits.json")
    ap.add_argument("--start-day", type=float)
    ap.add_argument("--end-day", type=float, help="exclusive")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--rps", type=float, help="target requests per second (default: as fast as possible)")
    ap.add_argument("--concurrency", type=int, default=1)
    ap.add_argument("--key-prefix", default="", help="prefix for Idempotency-Key (default: TransactionID alone)")
    args = ap.parse_args()

    start, end = args.start_day, args.end_day
    if args.split:
        s = json.loads(Path("data/clean/splits.json").read_text())
        start, end = {"train": (None, s["train_end_day"]),
                      "gap": (s["train_end_day"], s["cutoff_day"]),
                      "holdout": (s["cutoff_day"], None)}[args.split]

    df = load(args.parquet, start, end, args.limit)
    rows = df.to_dict("records")
    print(f"replaying {len(rows):,} transactions (days {start}..{end}) to {args.url} "
          f"at {'max' if not args.rps else args.rps} rps, concurrency {args.concurrency}", file=sys.stderr)

    pacer = Pacer(args.rps)
    local = threading.local()
    stats = {"fresh": 0, "replayed": 0, "errors": 0}
    verdicts: dict[str, int] = {}
    latencies: list[float] = []
    lock = threading.Lock()

    def send(row: dict) -> None:
        sess = getattr(local, "s", None)
        if sess is None:
            sess = local.s = requests.Session()
        pacer.wait()
        body = to_body(row)
        t0 = time.perf_counter()
        try:
            r = sess.post(f"{args.url}/v1/score", json=body,
                          headers={"Idempotency-Key": f"{args.key_prefix}{body['TransactionID']}"}, timeout=30)
            ms = (time.perf_counter() - t0) * 1000
            with lock:
                latencies.append(ms)
                if r.status_code != 200:
                    stats["errors"] += 1
                    if stats["errors"] <= 5:
                        print(f"error {r.status_code} for {body['TransactionID']}: {r.text[:200]}", file=sys.stderr)
                    return
                stats["replayed" if r.headers.get("idempotent-replayed") == "true" else "fresh"] += 1
                v = r.json()["verdict"]
                verdicts[v] = verdicts.get(v, 0) + 1
        except requests.RequestException as e:
            with lock:
                stats["errors"] += 1
                if stats["errors"] <= 5:
                    print(f"request failed for {body['TransactionID']}: {e}", file=sys.stderr)

    t_start = time.perf_counter()
    if args.concurrency <= 1:
        for i, row in enumerate(rows):
            send(row)
            if (i + 1) % 5000 == 0:
                print(f"  {i + 1:,} sent", file=sys.stderr)
    else:
        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            list(pool.map(send, rows))
    elapsed = time.perf_counter() - t_start

    lat = sorted(latencies)
    summary = {
        **stats,
        "sent": len(rows),
        "verdicts": verdicts,
        "seconds": round(elapsed, 2),
        "rps": round(len(rows) / elapsed, 1) if elapsed else None,
        "client_p50_ms": round(statistics.median(lat), 2) if lat else None,
        "client_p95_ms": round(lat[int(0.95 * (len(lat) - 1))], 2) if lat else None,
    }
    print(json.dumps(summary, indent=2))
    if stats["errors"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
