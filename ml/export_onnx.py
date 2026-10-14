"""Convert the LightGBM model to ONNX and write the Node parity fixture.

  ml/artifacts/model.onnx                         served by server/src/model/score.ts
  server/test/fixtures/parity_model.onnx          copy used by the CI parity test
  server/test/fixtures/parity_spec.json           feature spec for that copy
  server/test/fixtures/model_parity.json          1,000 holdout rows: request fields,
                                                  logged features and the Python score

The Node test rebuilds each feature vector from the request fields and logged
features with its own code, scores it with onnxruntime-node, and must match the
Python LightGBM score within a small tolerance.

Usage:
  python ml/export_onnx.py
"""

from __future__ import annotations

import json
import math
import shutil

import lightgbm as lgb
import numpy as np
import onnxruntime as ort
from onnxmltools import convert_lightgbm
from onnxmltools.convert.common.data_types import FloatTensorType

from dataset import ARTIFACTS, LOGGED, RAW_CATEGORICAL, RAW_NUMERIC, ROOT, encode, load_table

FIXTURES = ROOT / "server/test/fixtures"


def clean(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    return v.item() if hasattr(v, "item") else v


def main() -> None:
    spec = json.loads((ARTIFACTS / "feature_spec.json").read_text())
    booster = lgb.Booster(model_file=str(ARTIFACTS / "model.txt"))
    n = len(spec["features"])
    onx = convert_lightgbm(booster, initial_types=[("input", FloatTensorType([None, n]))], zipmap=False,
                           target_opset=15)
    out = ARTIFACTS / "model.onnx"
    out.write_bytes(onx.SerializeToString())

    df = load_table()
    ho = df[df.part == "holdout"].sample(n=min(1000, (df.part == "holdout").sum()), random_state=0)
    x = encode(ho, spec)
    py = booster.predict(x)
    sess = ort.InferenceSession(str(out), providers=["CPUExecutionProvider"])
    onnx_py = sess.run(None, {"input": x})[1][:, 1]
    diff = float(np.max(np.abs(py - onnx_py)))
    print(f"wrote {out} ({out.stat().st_size / 1e3:.0f} KB); max |LightGBM - ONNX| in Python = {diff:.2e}")

    FIXTURES.mkdir(parents=True, exist_ok=True)
    shutil.copy(out, FIXTURES / "parity_model.onnx")
    shutil.copy(ARTIFACTS / "feature_spec.json", FIXTURES / "parity_spec.json")
    rows = []
    for (_, r), s in zip(ho.iterrows(), py):
        rows.append({
            "tx": {c: clean(r[c]) for c in ["TransactionID", "TransactionDT"] + RAW_NUMERIC + RAW_CATEGORICAL},
            "features": {c: clean(r[c]) for c in LOGGED},
            "score": float(s),
        })
    (FIXTURES / "model_parity.json").write_text(json.dumps(rows))
    print(f"wrote {len(rows)} parity rows to {FIXTURES / 'model_parity.json'}")


if __name__ == "__main__":
    main()
