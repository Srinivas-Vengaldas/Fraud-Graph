"""Convert the LightGBM model to ONNX and write the Node parity fixture.

  ml/artifacts/model.onnx                  served by server/src/model/score.ts (not committed)
  server/test/fixtures/parity_model.onnx   a small model with the same feature spec, trained on
  server/test/fixtures/parity_spec.json    random synthetic rows, so the committed fixture holds
  server/test/fixtures/model_parity.json   nothing derived from the Kaggle data

The Node test rebuilds every feature vector from request fields and logged
features with its own code (including the derived features), scores it with
onnxruntime-node, and must match LightGBM in Python within a small tolerance.
The real model is checked against its ONNX export here, in Python.

Usage:
  python ml/export_onnx.py
"""

from __future__ import annotations

import json
import math

import lightgbm as lgb
import numpy as np
import onnxruntime as ort
import pandas as pd
from onnxmltools import convert_lightgbm
from onnxmltools.convert.common.data_types import FloatTensorType

from dataset import ARTIFACTS, DERIVED, LOGGED, RAW_CATEGORICAL, RAW_NUMERIC, ROOT, add_derived, encode, load_table

FIXTURES = ROOT / "server/test/fixtures"


def to_onnx(booster: lgb.Booster, n_features: int) -> bytes:
    onx = convert_lightgbm(booster, initial_types=[("input", FloatTensorType([None, n_features]))], zipmap=False,
                           target_opset=15)
    return onx.SerializeToString()


def onnx_scores(model: bytes, x: np.ndarray) -> np.ndarray:
    sess = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
    return sess.run(None, {"input": x})[1][:, 1]


def synthetic_rows(spec: dict, n: int, seed: int = 0) -> pd.DataFrame:
    """Random rows over the spec's fields: plausible ranges, 20% missing, no real records."""
    rng = np.random.default_rng(seed)
    df = pd.DataFrame({
        "TransactionID": np.arange(n) + 1,
        "TransactionDT": rng.integers(86_400, 200 * 86_400, n),
        "TransactionAmt": np.round(rng.lognormal(4, 1, n), 3),
    })
    for c in LOGGED + RAW_NUMERIC:
        if c in df:
            continue
        v = np.round(rng.gamma(1.5, 20, n), 2) if c != "D1" else rng.integers(0, 600, n).astype(float)
        df[c] = np.where(rng.random(n) < 0.2, np.nan, v)
    for c in RAW_CATEGORICAL:
        vocab = spec["categorical"][c] + ["never-seen"]
        df[c] = [None if rng.random() < 0.2 else vocab[i] for i in rng.integers(0, len(vocab), n)]
    return add_derived(df)


def clean(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    return v.item() if hasattr(v, "item") else v


def main() -> None:
    spec = json.loads((ARTIFACTS / "feature_spec.json").read_text())
    n = len(spec["features"])

    # Real model: export and check in Python.
    booster = lgb.Booster(model_file=str(ARTIFACTS / "model.txt"))
    model = to_onnx(booster, n)
    (ARTIFACTS / "model.onnx").write_bytes(model)
    ho = load_table().query("part == 'holdout'").sample(n=2000, random_state=0)
    x = encode(ho, spec)
    diff = float(np.max(np.abs(booster.predict(x) - onnx_scores(model, x))))
    print(f"wrote ml/artifacts/model.onnx ({len(model) / 1e3:.0f} KB); max |LightGBM - ONNX| on 2,000 holdout rows = {diff:.2e}")

    # Committed fixture: same spec, synthetic rows and a small model trained on them.
    train = synthetic_rows(spec, 5000, seed=1)
    xt = encode(train, spec)
    signal = np.nan_to_num(xt[:, 0]) + 3 * (train["hour_of_day"].to_numpy() < 6) + (train["TransactionAmt"].to_numpy() > 150)
    yt = (signal + np.random.default_rng(2).normal(0, 1, len(train)) > 3).astype(int)
    small = lgb.train({"objective": "binary", "num_leaves": 15, "verbose": -1, "seed": 0},
                      lgb.Dataset(xt, yt, feature_name=spec["features"]), 60)
    fixture_model = to_onnx(small, n)
    (FIXTURES / "parity_model.onnx").write_bytes(fixture_model)
    (FIXTURES / "parity_spec.json").write_text(json.dumps(spec, indent=2))

    test = synthetic_rows(spec, 1000, seed=3)
    scores = small.predict(encode(test, spec))
    tx_cols = ["TransactionID", "TransactionDT"] + RAW_NUMERIC + RAW_CATEGORICAL
    rows = [{"tx": {c: clean(r[c]) for c in tx_cols}, "features": {c: clean(r[c]) for c in LOGGED}, "score": float(s)}
            for (_, r), s in zip(test.iterrows(), scores)]
    (FIXTURES / "model_parity.json").write_text(json.dumps(rows))
    assert all(f in spec["features"] for f in DERIVED)
    print(f"wrote synthetic parity fixture: {len(rows)} rows, {n} features")


if __name__ == "__main__":
    main()
