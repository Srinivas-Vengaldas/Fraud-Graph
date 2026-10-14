"""Training table: logged serving features + a few raw request columns + labels.

The feature spec (column order and category codes) is written next to the model
and read by the Node scorer, so both sides build the exact same vector.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "prep"))
from split import DAY, assign  # noqa: E402

# Computed by the API (server/src/decision/features.ts) and read from the feature log.
LOGGED = [
    "card_tx_1h", "card_tx_24h", "card_amt_1h", "card_amt_24h",
    "device_tx_1h", "device_tx_24h", "device_amt_1h", "device_amt_24h", "device_cards_24h",
    "ring_size", "ring_fraud_entities", "ring_fraud_others",
    "blocklist_card", "blocklist_device", "has_device", "device_generic", "amt_share_card_24h",
]
# Raw request fields, passed through unchanged at serving time.
RAW_NUMERIC = ["TransactionAmt", "addr1", "C1", "C2", "C13", "C14", "D1", "D2", "D4", "D10", "D15"]
RAW_CATEGORICAL = ["ProductCD", "card4", "card6"]

ARTIFACTS = ROOT / "ml/artifacts"


def build_spec(df: pd.DataFrame) -> dict:
    cats = {c: sorted(df[c].dropna().astype(str).unique().tolist()) for c in RAW_CATEGORICAL}
    return {"features": LOGGED + RAW_NUMERIC + RAW_CATEGORICAL, "categorical": cats,
            "missing_category": -1, "note": "categories are coded by their index in the list; unknown or missing -> -1"}


def encode(df: pd.DataFrame, spec: dict) -> np.ndarray:
    cols = []
    for f in spec["features"]:
        if f in spec["categorical"]:
            codes = {v: i for i, v in enumerate(spec["categorical"][f])}
            cols.append(df[f].map(lambda v: codes.get(str(v), -1) if pd.notna(v) else -1).astype(np.float32))
        else:
            cols.append(pd.to_numeric(df[f], errors="coerce").astype(np.float32))
    return np.column_stack(cols).astype(np.float32)


def load_table(parquet: str = "data/clean/train.parquet", features: str = "data/clean/features.parquet",
               splits: str = "data/clean/splits.json") -> pd.DataFrame:
    raw = pd.read_parquet(ROOT / parquet, columns=["TransactionID", "TransactionDT", "isFraud"] + RAW_NUMERIC + RAW_CATEGORICAL)
    logged = pd.read_parquet(ROOT / features)
    df = raw.merge(logged[["TransactionID"] + LOGGED], on="TransactionID", how="inner")
    df["part"] = assign(df.TransactionDT, json.loads((ROOT / splits).read_text()))
    df["day"] = df.TransactionDT // DAY
    return df.sort_values(["TransactionDT", "TransactionID"]).reset_index(drop=True)


def train_valid_split(train: pd.DataFrame, valid_share: float = 0.15) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Last 15% of the training period by time is the validation slice."""
    cut = train.TransactionDT.quantile(1 - valid_share)
    return train[train.TransactionDT < cut], train[train.TransactionDT >= cut]


def save_json(name: str, obj: dict) -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    (ARTIFACTS / name).write_text(json.dumps(obj, indent=2))
