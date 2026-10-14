"""Lift from ML on the holdout, at the same analyst capacity.

Run after replaying the holdout with the model active. For each holdout
transaction the API logged what the rules alone decided (rules_verdict) and the
model score (model_score), so all three policies are compared on the very same
stream of decisions:

  rules only   : the rules' declines; the analyst queue takes rule hits in order
                 of rule score (then age) up to capacity
  model only   : decline at the cost-chosen decline threshold; the queue takes
                 the highest model scores up to capacity
  rules + model: decline if either declines; the queue holds rule hits plus
                 model scores above the review threshold, highest model score first

Every policy gets the same number of reviews (ANALYST_CAPACITY_SHARE of holdout
volume), so differences come from which cases are picked, not from reviewing more.
The deployed policy (cost-chosen thresholds, no volume cap) is reported too.

Usage:
  python ml/lift.py
"""

from __future__ import annotations

import json
import sys

import numpy as np
import pandas as pd

from assumptions import ANALYST_CAPACITY_SHARE, COST_PER_REVIEW, MARGIN, net_dollars
from dataset import ARTIFACTS, ROOT, load_table
from results_md import README, upsert_section

sys.path.insert(0, str(ROOT / "prep"))
from db import connect  # noqa: E402

REVIEW, DECLINE = 1, 2


def outcome(name: str, verdict: np.ndarray, y: np.ndarray, amt: np.ndarray) -> dict:
    fraud = y == 1
    declined, reviewed = verdict == DECLINE, verdict == REVIEW
    flagged = declined | reviewed
    m = {
        "policy": name,
        "reviews": int(reviewed.sum()),
        "declines": int(declined.sum()),
        "recall": float((flagged & fraud).sum() / max(1, fraud.sum())),
        "fpr": float((flagged & ~fraud).sum() / max(1, (~fraud).sum())),
        "fraud_amt_declined": float(amt[declined & fraud].sum()),
        "fraud_amt_reviewed": float(amt[reviewed & fraud].sum()),
        "legit_amt_declined": float(amt[declined & ~fraud].sum()),
    }
    m["net"] = net_dollars(m["fraud_amt_declined"], m["fraud_amt_reviewed"], m["reviews"], m["legit_amt_declined"])
    return m


def cap_reviews(verdict: np.ndarray, candidates: np.ndarray, score: np.ndarray, volume: int) -> np.ndarray:
    v = verdict.copy()
    idx = np.where(candidates & (v != DECLINE))[0]
    keep = idx[np.argsort(-score[idx], kind="stable")[:volume]]
    v[keep] = REVIEW
    return v


def main() -> None:
    thr = json.loads((ARTIFACTS / "thresholds.json").read_text())
    with connect() as conn:
        rows = conn.execute(
            "SELECT f.transaction_id, (f.features->>'rules_verdict')::int, (f.features->>'rules_score')::float8, "
            "(f.features->>'model_score')::float8, d.verdict FROM features f JOIN decisions d USING (transaction_id)").fetchall()
    logs = pd.DataFrame(rows, columns=["TransactionID", "rules_verdict", "rules_score", "model_score", "deployed"])
    df = load_table()
    ho = df[df.part == "holdout"][["TransactionID", "TransactionAmt", "isFraud"]].merge(logs, on="TransactionID")
    if ho.model_score.isna().any():
        sys.exit("holdout was replayed without the model; restart the API with ml/artifacts/model.onnx and replay")

    y, amt, s = ho.isFraud.to_numpy(), ho.TransactionAmt.to_numpy(), ho.model_score.to_numpy()
    rules_v = ho.rules_verdict.to_numpy()
    volume = int(round(ANALYST_CAPACITY_SHARE * len(ho)))
    rules_score = ho.rules_score.to_numpy()

    rules_only = np.where(rules_v == DECLINE, DECLINE, 0)
    rules_only = cap_reviews(rules_only, rules_v == REVIEW, rules_score, volume)
    rules = outcome("Rules only", rules_only, y, amt)

    model_v = np.where(s >= thr["decline_threshold"], DECLINE, 0)
    model_v = cap_reviews(model_v, np.ones_like(s, dtype=bool), s, volume)
    model = outcome("Model only", model_v, y, amt)

    both_v = np.where((rules_v == DECLINE) | (s >= thr["decline_threshold"]), DECLINE, 0)
    candidates = (rules_v == REVIEW) | (s >= thr["review_threshold"])
    both_v = cap_reviews(both_v, candidates, s, volume)
    both = outcome("Rules + model", both_v, y, amt)

    dep = outcome("Rules + model, deployed thresholds", ho.deployed.map({"approve": 0, "review": 1, "decline": 2}).to_numpy(), y, amt)

    res = {"review_volume": volume, "rows": [rules, model, both, dep], "thresholds": thr}
    (ARTIFACTS / "lift.json").write_text(json.dumps(res, indent=2))
    source = (ROOT / "data/clean/source.txt").read_text().strip()
    note = " on the synthetic development sample (not results)" if "sample" in source else ""

    def line(m):
        return (f"| {m['policy']} | {m['reviews']:,} / {m['declines']:,} | {m['recall']:.1%} | {m['fpr']:.2%} | "
                f"${m['fraud_amt_declined'] + m['fraud_amt_reviewed']:,.0f} | ${m['legit_amt_declined']:,.0f} | ${m['net']:,.0f} |")

    header = ["| Policy | Reviews / declines | Recall | False-positive rate | Fraud $ stopped | Good-customer $ declined | Net $ |",
              "|---|---|---|---|---|---|---|"]
    body = "\n".join([
        "## Lift from ML (holdout)",
        "",
        f"Generated by [`ml/lift.py`](../ml/lift.py) from the API's own decision and feature logs{note}. "
        f"The first three rows get the same analyst capacity: {volume:,} reviews, {ANALYST_CAPACITY_SHARE:.0%} of holdout volume. "
        f"The last row is what the API actually decided with the cost-chosen thresholds "
        f"(review ≥ {thr['review_threshold']:.3f}, decline ≥ {thr['decline_threshold']:.3f}). "
        f"${COST_PER_REVIEW:.0f} per review, {MARGIN:.0%} margin.",
        "",
        *header, line(rules), line(model), line(both), line(dep),
    ])
    upsert_section("lift", body)
    upsert_section("results-table", "\n".join([
        f"Holdout, same analyst capacity for each policy ({volume:,} reviews, {ANALYST_CAPACITY_SHARE:.0%} of volume){note}. "
        "From [`ml/lift.py`](ml/lift.py); details in [docs/results.md](docs/results.md).",
        "",
        *header, line(rules), line(model), line(both),
    ]), README)
    print(body)


if __name__ == "__main__":
    main()
