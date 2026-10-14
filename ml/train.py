"""Train LightGBM on the time split.

  train      = training period minus its last 15% (by time)
  validation = last 15% of the training period: early stopping and threshold tuning
  holdout    = never touched here (ml/evaluate.py reports it once)

Imbalance is handled with scale_pos_weight = negatives / positives, not oversampling.

Usage:
  python ml/train.py
"""

from __future__ import annotations

import argparse
import subprocess

import lightgbm as lgb
import numpy as np

from dataset import ARTIFACTS, build_spec, encode, load_table, save_json, train_valid_split
from metrics import summary


def git_commit() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
    except Exception:
        return "unknown"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rounds", type=int, default=2000)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    df = load_table()
    tr, va = train_valid_split(df[df.part == "train"])
    spec = build_spec(tr)
    xtr, ytr = encode(tr, spec), tr.isFraud.to_numpy()
    xva, yva = encode(va, spec), va.isFraud.to_numpy()
    spw = float((ytr == 0).sum() / max(1, (ytr == 1).sum()))

    params = {
        "objective": "binary",
        "learning_rate": 0.03,
        "num_leaves": 31,
        "min_child_samples": 50,
        "feature_fraction": 0.8,
        "bagging_fraction": 0.8,
        "bagging_freq": 1,
        "lambda_l2": 1.0,
        "scale_pos_weight": spw,
        "metric": "average_precision",
        "seed": args.seed,
        "deterministic": True,
        "num_threads": 4,
        "verbose": -1,
    }
    dtr = lgb.Dataset(xtr, ytr, feature_name=spec["features"], free_raw_data=False)
    dva = lgb.Dataset(xva, yva, reference=dtr)
    model = lgb.train(params, dtr, args.rounds, valid_sets=[dva], valid_names=["valid"],
                      callbacks=[lgb.early_stopping(100, verbose=False), lgb.log_evaluation(0)])

    s_va = model.predict(xva, num_iteration=model.best_iteration)
    val = summary(yva, s_va, k=max(1, int(0.01 * len(yva))))
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    model.save_model(str(ARTIFACTS / "model.txt"), num_iteration=model.best_iteration)
    save_json("feature_spec.json", spec)
    imp = dict(zip(spec["features"], model.feature_importance("gain").round(1).tolist()))
    meta = {
        "commit": git_commit(),
        "best_iteration": model.best_iteration,
        "scale_pos_weight": spw,
        "train_rows": int(len(tr)), "train_days": [int(tr.day.min()), int(tr.day.max())],
        "valid_rows": int(len(va)), "valid_days": [int(va.day.min()), int(va.day.max())],
        "validation": val,
        "importance_gain": dict(sorted(imp.items(), key=lambda kv: -kv[1])),
        "params": params,
    }
    save_json("train_meta.json", meta)
    np.save(ARTIFACTS / "valid_scores.npy", np.column_stack([va.TransactionID.to_numpy(), s_va]))
    print(f"best iteration {model.best_iteration}; validation PR-AUC {val['pr_auc']:.4f}, "
          f"recall@1%FPR {val['recall_at_1pct_fpr']:.2%}")
    print("top features:", list(meta["importance_gain"])[:8])


if __name__ == "__main__":
    main()
