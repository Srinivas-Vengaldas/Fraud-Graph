"""Entity keys: the approximate "who" behind a transaction.

  card_entity   = f"{card1}|{addr1}|{floor(TransactionDT / 86400 - D1)}"
  device_entity = f"{DeviceInfo}|{id_30}|{id_31}|{id_33}"   (only if DeviceInfo present)

D1 is days since the card was first used, so TransactionDT/86400 - D1 is a
fixed day for a given card: the card's "birth day". Combined with card1 and
addr1 it approximates one customer. This is a hypothesis to test, not a fact.

The TypeScript twin is server/src/entities/keys.ts. Both must produce identical
strings; server/test/entityParity.test.ts checks this on 1,000 rows.
Missing values are written as "NA". Integral numbers are written without ".0".
"""

from __future__ import annotations

import math

DAY = 86_400
NA = "NA"


def _missing(v) -> bool:
    return v is None or (isinstance(v, float) and math.isnan(v))


def fmt(v) -> str:
    if _missing(v):
        return NA
    if isinstance(v, bool):
        return str(v).lower()
    if isinstance(v, (int,)) or (isinstance(v, float) and v.is_integer()):
        return str(int(v))
    if isinstance(v, float):
        return repr(v)
    if hasattr(v, "item"):  # numpy scalar
        return fmt(v.item())
    return str(v)


def birth_day(transaction_dt, d1) -> str:
    if _missing(transaction_dt) or _missing(d1):
        return NA
    return str(math.floor(float(transaction_dt) / DAY - float(d1)))


def card_entity(row: dict) -> str:
    return f"{fmt(row.get('card1'))}|{fmt(row.get('addr1'))}|{birth_day(row.get('TransactionDT'), row.get('D1'))}"


def device_entity(row: dict) -> str | None:
    info = row.get("DeviceInfo")
    if _missing(info) or info == "":
        return None
    return f"{fmt(info)}|{fmt(row.get('id_30'))}|{fmt(row.get('id_31'))}|{fmt(row.get('id_33'))}"


def add_entity_columns(df):
    """Vectorized-enough helper for pandas frames (row-wise for exact parity)."""
    recs = df[[c for c in ("card1", "addr1", "TransactionDT", "D1", "DeviceInfo", "id_30", "id_31", "id_33")
               if c in df.columns]].to_dict("records")
    df = df.copy()
    df["card_entity"] = [card_entity(r) for r in recs]
    df["device_entity"] = [device_entity(r) for r in recs]
    return df


FIXTURE_COLS = ["TransactionID", "TransactionDT", "card1", "addr1", "D1", "DeviceInfo", "id_30", "id_31", "id_33"]


def write_parity_fixture(parquet: str, out: str, n: int = 1000, seed: int = 0) -> None:
    """Write n rows plus the Python keys for the TypeScript parity test."""
    import json

    import pandas as pd

    df = pd.read_parquet(parquet, columns=FIXTURE_COLS)
    # Make sure the awkward cases are in the sample: missing addr1, missing D1, no device.
    edge = pd.concat([df[df.addr1.isna()].head(50), df[df.D1.isna()].head(50), df[df.DeviceInfo.notna()].head(100)])
    rest = df.drop(edge.index).sample(n=max(0, n - len(edge)), random_state=seed)
    sample = pd.concat([edge, rest]).head(n)
    rows = []
    for r in sample.to_dict("records"):
        clean = {k: (None if _missing(v) else (v.item() if hasattr(v, "item") else v)) for k, v in r.items()}
        rows.append({"row": clean, "card_entity": card_entity(clean), "device_entity": device_entity(clean)})
    with open(out, "w") as f:
        json.dump(rows, f, indent=0)
    print(f"wrote {len(rows)} parity rows to {out}")


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Write the entity-key parity fixture")
    ap.add_argument("--parquet", default="data/clean/train.parquet")
    ap.add_argument("--out", default="server/test/fixtures/entity_parity.json")
    ap.add_argument("-n", type=int, default=1000)
    a = ap.parse_args()
    write_parity_fixture(a.parquet, a.out, a.n)
