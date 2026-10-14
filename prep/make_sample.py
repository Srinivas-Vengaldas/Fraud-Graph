"""Generate a small synthetic dataset with the IEEE-CIS column layout.

The real data needs a Kaggle account and token. This sample lets every stage
of the pipeline (Parquet, splits, API, replay, rings, model) run end to end
before the real download is available. Numbers from the sample are NOT
results; they only prove the code works.

What it simulates:
  * ordinary customers with a stable card, address, email and device
  * account takeovers: after a compromise day, the rest of a card's
    transactions are labeled fraud (mirrors the competition labeling rule)
  * fraud rings: several freshly issued cards hitting the same rare device
    in a short burst
  * generic device strings ("Windows", "iOS Device") shared by many people,
    which is what the supernode cap has to deal with

Usage:
  python prep/make_sample.py --out data/raw-sample --customers 20000
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

DAY = 86_400
N_DAYS = 182
FIRST_ID = 2_987_000

EMAILS = ["gmail.com", "yahoo.com", "hotmail.com", "anonymous.com", "aol.com",
          "comcast.net", "icloud.com", "outlook.com", "msn.com", "att.net"]
EMAIL_P = [0.42, 0.18, 0.09, 0.08, 0.07, 0.05, 0.04, 0.03, 0.02, 0.02]

GENERIC_DEVICES = [
    ("Windows", "Windows 10", "chrome 63.0", "1920x1080", "desktop"),
    ("Windows", "Windows 7", "chrome 63.0", "1366x768", "desktop"),
    ("iOS Device", "iOS 11.2.1", "mobile safari 11.0", "2208x1242", "mobile"),
    ("iOS Device", "iOS 11.1.2", "mobile safari 11.0", "1334x750", "mobile"),
    ("MacOS", "Mac OS X 10_12_6", "safari generic", "2560x1600", "desktop"),
    ("Trident/7.0", "Windows 7", "ie 11.0 for desktop", "1366x768", "desktop"),
]
PRODUCTS = ["W", "C", "R", "H", "S"]
PRODUCT_P = [0.74, 0.11, 0.07, 0.06, 0.02]


def rare_device(rng: np.random.Generator) -> tuple[str, str, str, str, str]:
    model = f"SM-{rng.choice(['G', 'J', 'A', 'N'])}{rng.integers(100, 999)}{rng.choice(['F', 'U', 'W'])} Build/{rng.choice(['NRD90M', 'MMB29K', 'R16NW'])}"
    return (model, f"Android {rng.choice(['7.0', '6.0.1', '8.0.0'])}",
            f"chrome {rng.integers(60, 66)}.0 for android",
            f"{rng.choice([720, 1080, 1440])}x{rng.choice([1280, 1920, 2560])}", "mobile")


def new_card(rng: np.random.Generator) -> dict:
    return {
        "card1": int(rng.integers(1000, 18397)),
        "card2": float(rng.integers(100, 601)),
        "card3": 150.0,
        "card4": rng.choice(["visa", "mastercard", "american express", "discover"], p=[0.65, 0.31, 0.02, 0.02]),
        "card5": float(rng.choice([226, 224, 166, 102, 117, 138])),
        "card6": rng.choice(["debit", "credit"], p=[0.75, 0.25]),
        "addr1": float(rng.integers(100, 541)) if rng.random() > 0.11 else np.nan,
        "addr2": 87.0,
    }


def generate(n_customers: int, seed: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    rng = np.random.default_rng(seed)
    rows: list[dict] = []
    ident: dict[int, tuple] = {}  # row index -> device tuple

    def emit(card: dict, first_day: float, t_sec: float, amt: float, email: str,
             device: tuple | None, fraud: int, product: str, n_prior: int) -> None:
        day = t_sec / DAY
        r = dict(card)
        r.update({
            "TransactionDT": int(t_sec),
            "TransactionAmt": round(float(amt), 3),
            "ProductCD": product,
            "P_emaildomain": email if rng.random() > 0.15 else np.nan,
            "R_emaildomain": email if product == "C" and rng.random() > 0.3 else np.nan,
            "isFraud": fraud,
            "C1": float(n_prior + 1 + rng.poisson(0.3)),
            "C2": float(n_prior + 1),
            "C13": float(n_prior + rng.poisson(1.0)),
            "C14": float(min(n_prior + 1, 3)),
            "D1": float(np.floor(day - first_day)),
            "D2": float(np.floor(day - first_day)) if rng.random() > 0.45 else np.nan,
            "D4": float(np.floor(day - first_day) + rng.integers(-2, 3)) if rng.random() > 0.3 else np.nan,
            "D10": float(np.floor(day - first_day)) if rng.random() > 0.15 else np.nan,
            "D15": float(np.floor(day - first_day) + rng.integers(0, 4)) if rng.random() > 0.15 else np.nan,
        })
        if device is not None:
            ident[len(rows)] = device
        rows.append(r)

    # Ordinary customers, some later taken over.
    for _ in range(n_customers):
        card = new_card(rng)
        first_day = float(rng.integers(-400, N_DAYS - 5))
        email = rng.choice(EMAILS, p=EMAIL_P)
        has_device = rng.random() < 0.25
        if has_device:
            device = GENERIC_DEVICES[rng.integers(len(GENERIC_DEVICES))] if rng.random() < 0.7 else rare_device(rng)
        else:
            device = None
        n = 1 + rng.poisson(2.0)
        start = max(first_day, 0) + 1
        times = np.sort(rng.uniform(start * DAY, N_DAYS * DAY, size=n))
        takeover_at = None
        if rng.random() < 0.006 and n >= 2:
            takeover_at = times[rng.integers(1, n)]
        for i, t in enumerate(times):
            fraud = int(takeover_at is not None and t >= takeover_at)
            amt = rng.lognormal(4.0, 0.9) * (2.2 if fraud else 1.0)
            prod = rng.choice(PRODUCTS, p=PRODUCT_P)
            emit(card, first_day, t, amt, email, device, fraud, prod, i)
            if fraud and rng.random() < 0.6:  # takeover bursts
                for j in range(int(rng.integers(1, 4))):
                    emit(card, first_day, t + rng.uniform(60, 3 * 3600), rng.lognormal(5.0, 0.6),
                         email, device, 1, prod, i + j + 1)

    # Fraud rings: waves of fresh cards reusing the same one or two rare devices.
    # A ring comes back weeks later with new cards but the same devices, which is
    # what lets prior fraud on a device flag the next wave.
    n_rings = max(1, n_customers // 220)
    for _ in range(n_rings):
        devices = [rare_device(rng) for _ in range(int(rng.integers(1, 3)))]
        ring_email = rng.choice(["anonymous.com", "gmail.com", "hotmail.com", "outlook.com"])
        for _ in range(int(rng.integers(1, 4))):
            start_day = float(rng.uniform(1, N_DAYS - 3))
            for _ in range(int(rng.integers(2, 7))):
                card = new_card(rng)
                first_day = start_day - float(rng.integers(0, 3))
                for k in range(int(rng.integers(1, 5))):
                    t = (start_day + rng.uniform(0, 2.5)) * DAY
                    prod = rng.choice(["C", "W", "H"], p=[0.5, 0.35, 0.15])
                    emit(card, first_day, t, rng.lognormal(5.2, 0.7), ring_email,
                         devices[rng.integers(len(devices))], 1, prod, k)

    df = pd.DataFrame(rows)
    order = np.argsort(df["TransactionDT"].to_numpy(), kind="stable")
    df = df.iloc[order].reset_index(drop=False).rename(columns={"index": "_src"})
    df.insert(0, "TransactionID", np.arange(FIRST_ID, FIRST_ID + len(df)))
    df["TransactionDT"] = df["TransactionDT"].clip(lower=DAY)

    id_rows = []
    for tid, src in zip(df["TransactionID"], df["_src"]):
        dev = ident.get(int(src))
        if dev is not None:
            id_rows.append({"TransactionID": tid, "id_30": dev[1], "id_31": dev[2], "id_33": dev[3],
                            "DeviceType": dev[4], "DeviceInfo": dev[0]})
    identity = pd.DataFrame(id_rows)
    df = df.drop(columns="_src")
    # Remaining masked D columns: mostly missing, as in the real data.
    for i in (3, 5, 6, 7, 8, 9, 11, 12, 13, 14):
        vals = np.floor(rng.uniform(0, 500, size=len(df)))
        df[f"D{i}"] = np.where(rng.random(len(df)) < 0.85, np.nan, vals)
    cols = ["TransactionID", "isFraud", "TransactionDT", "TransactionAmt", "ProductCD",
            "card1", "card2", "card3", "card4", "card5", "card6", "addr1", "addr2",
            "P_emaildomain", "R_emaildomain", "C1", "C2", "C13", "C14",
            ] + [f"D{i}" for i in range(1, 16)]
    return df[cols], identity


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/raw-sample")
    ap.add_argument("--customers", type=int, default=20_000)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    tx, ident = generate(args.customers, args.seed)
    tx.to_csv(out / "train_transaction.csv", index=False)
    ident.to_csv(out / "train_identity.csv", index=False)
    print(f"wrote {len(tx):,} transactions ({tx.isFraud.mean():.2%} fraud) and "
          f"{len(ident):,} identity rows to {out}")


if __name__ == "__main__":
    main()
