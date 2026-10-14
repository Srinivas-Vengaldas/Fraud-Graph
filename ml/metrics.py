"""Metrics that count for fraud: never accuracy (approving everything is ~96.5% accurate)."""

from __future__ import annotations

import numpy as np
from sklearn.metrics import average_precision_score, roc_auc_score, roc_curve


def recall_at_fpr(y: np.ndarray, s: np.ndarray, fpr_target: float = 0.01) -> tuple[float, float]:
    """Highest recall with false-positive rate <= target, and the score threshold that gives it."""
    fpr, tpr, thr = roc_curve(y, s)
    ok = np.where(fpr <= fpr_target)[0]
    i = ok[np.argmax(tpr[ok])]
    return float(tpr[i]), float(thr[i])


def precision_at_k(y: np.ndarray, s: np.ndarray, k: int) -> float:
    k = min(k, len(s))
    top = np.argsort(-s, kind="stable")[:k]
    return float(y[top].mean()) if k else 0.0


def summary(y: np.ndarray, s: np.ndarray, k: int) -> dict:
    r, thr = recall_at_fpr(y, s, 0.01)
    return {
        "n": int(len(y)),
        "fraud_rate": float(y.mean()),
        "pr_auc": float(average_precision_score(y, s)),
        "roc_auc": float(roc_auc_score(y, s)),
        "recall_at_1pct_fpr": r,
        "threshold_at_1pct_fpr": thr,
        "top_k": int(k),
        "precision_at_top_k": precision_at_k(y, s, k),
    }
