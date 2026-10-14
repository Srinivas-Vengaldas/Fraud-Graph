"""Choose review and decline thresholds by dollars, within analyst capacity.

For every pair (review_t <= decline_t) on a grid of validation-score quantiles:

  net = fraud_amt_blocked - reviews * cost_per_review - legit_amt_declined * margin

where a score >= decline_t is declined, review_t <= score < decline_t goes to an
analyst (who stops the fraud), and the rest is approved. A real team can only
review so many cases a day, so pairs that would send more than the capacity share
of daily volume to review are not allowed. The best allowed pair on the validation
slice is the operating point; it is reported once on the holdout.

Capacities 0.5%, 1%, 2%, 5% of daily volume and "unlimited" are all reported; the
API uses ANALYST_CAPACITY_SHARE from ml/assumptions.py. The base capacity is also
re-run with the margin doubled.

Writes ml/artifacts/thresholds.json (read by the API), docs/img/cost_curve.png,
and sections of docs/results.md and README.md.

Usage:
  python ml/costs.py
"""

from __future__ import annotations

import json

import lightgbm as lgb
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from assumptions import ANALYST_CAPACITY_SHARE, COST_PER_REVIEW, MARGIN, MAX_DECLINE_SHARE  # noqa: E402
from dataset import ARTIFACTS, DAY, ROOT, encode, load_table, save_json, train_valid_split  # noqa: E402
from results_md import README, upsert_section  # noqa: E402

CAPACITIES = [0.005, 0.01, 0.02, 0.05, None]  # share of daily volume; None = unlimited


def evaluate_pair(s, y, amt, review_t, decline_t, cost_per_review, margin, days) -> dict:
    declined = s >= decline_t
    reviewed = (s >= review_t) & ~declined
    fraud = y == 1
    fraud_blocked = amt[(declined | reviewed) & fraud].sum()
    legit_declined = amt[declined & ~fraud].sum()
    n_reviews = int(reviewed.sum())
    flagged = declined | reviewed
    return {
        "review_t": float(review_t), "decline_t": float(decline_t),
        "net": float(fraud_blocked - n_reviews * cost_per_review - legit_declined * margin),
        "fraud_blocked": float(fraud_blocked), "legit_declined": float(legit_declined),
        "reviews": n_reviews, "reviews_per_day": n_reviews / days, "declines": int(declined.sum()),
        "recall": float((flagged & fraud).sum() / max(1, fraud.sum())),
        "fpr": float((flagged & ~fraud).sum() / max(1, (~fraud).sum())),
    }


def search(s, y, amt, cost_per_review, margin, grid, max_reviews, max_declines):
    """Best (review_t, decline_t) by net dollars within review and decline limits, using prefix sums."""
    order = np.argsort(-s, kind="stable")
    ss, yy, aa = s[order], y[order], amt[order]
    cum_fraud_amt = np.concatenate([[0.0], np.cumsum(np.where(yy == 1, aa, 0.0))])
    cum_legit_amt = np.concatenate([[0.0], np.cumsum(np.where(yy == 0, aa, 0.0))])
    # number of rows with score >= t (scores sorted descending)
    above = {t: int(np.searchsorted(-ss, -t, side="right")) for t in grid}
    best = None
    for r in grid:
        nr = above[r]
        for d in grid:
            if d < r:
                continue
            nd = above[d]
            reviews = nr - nd
            if max_reviews is not None and reviews > max_reviews:
                continue
            if nd > max_declines:
                continue
            net = cum_fraud_amt[nr] - reviews * cost_per_review - cum_legit_amt[nd] * margin
            if best is None or net > best[0]:
                best = (net, r, d)
    return best[1], best[2]


def main() -> None:
    spec = json.loads((ARTIFACTS / "feature_spec.json").read_text())
    model = lgb.Booster(model_file=str(ARTIFACTS / "model.txt"))
    df = load_table()
    _, va = train_valid_split(df[df.part == "train"])
    ho = df[df.part == "holdout"]
    s_va, s_ho = model.predict(encode(va, spec)), model.predict(encode(ho, spec))
    y_va, y_ho = va.isFraud.to_numpy(), ho.isFraud.to_numpy()
    a_va, a_ho = va.TransactionAmt.to_numpy(), ho.TransactionAmt.to_numpy()
    days_va = (va.TransactionDT.max() - va.TransactionDT.min()) / DAY
    days_ho = (ho.TransactionDT.max() - ho.TransactionDT.min()) / DAY

    q = np.concatenate([np.linspace(0.5, 0.99, 120), 1 - np.logspace(-2, -4, 60)])
    grid = np.unique(np.concatenate([np.quantile(s_va, q), [1.0 + 1e-9]]))

    def run(cap, margin):
        max_reviews = None if cap is None else cap * len(va)
        r, d = search(s_va, y_va, a_va, COST_PER_REVIEW, margin, grid, max_reviews, MAX_DECLINE_SHARE * len(va))
        return {"capacity": cap, "margin": margin,
                "validation": evaluate_pair(s_va, y_va, a_va, r, d, COST_PER_REVIEW, margin, days_va),
                "holdout": evaluate_pair(s_ho, y_ho, a_ho, r, d, COST_PER_REVIEW, margin, days_ho)}

    rows = [run(c, MARGIN) for c in CAPACITIES]
    base = next(r for r in rows if r["capacity"] == ANALYST_CAPACITY_SHARE)
    doubled = run(ANALYST_CAPACITY_SHARE, 2 * MARGIN)
    op = base["validation"]
    save_json("thresholds.json", {"review_threshold": op["review_t"], "decline_threshold": op["decline_t"],
                                  "cost_per_review": COST_PER_REVIEW, "margin": MARGIN,
                                  "analyst_capacity_share": ANALYST_CAPACITY_SHARE, "max_decline_share": MAX_DECLINE_SHARE})

    img = ROOT / "docs/img"
    img.mkdir(parents=True, exist_ok=True)
    capped = [r for r in rows if r["capacity"] is not None]
    fig, ax = plt.subplots(figsize=(7, 4))
    x = [100 * r["capacity"] for r in capped]
    ax.plot(x, [r["validation"]["net"] for r in capped], marker="o", color="#2563eb", label="validation (picked here)")
    ax.plot(x, [r["holdout"]["net"] for r in capped], marker="o", color="#d97706", label="holdout (reported once)")
    ax.axvline(100 * ANALYST_CAPACITY_SHARE, color="#64748b", linestyle="--", linewidth=1)
    ax.set_xscale("log")
    ax.set_xticks(x, [f"{v:g}%" for v in x])
    ax.set_xlabel("analyst capacity (share of daily transactions reviewed)")
    ax.set_ylabel("net dollars saved")
    ax.set_title(f"Net dollars vs analyst capacity (${COST_PER_REVIEW:.0f} per review, {MARGIN:.0%} margin)")
    ax.grid(alpha=0.3)
    ax.legend(frameon=False)
    fig.tight_layout()
    fig.savefig(img / "cost_curve.png", dpi=150)

    source = (ROOT / "data/clean/source.txt").read_text().strip()
    sample = "sample" in source

    def line(r):
        v, h = r["validation"], r["holdout"]
        cap = "unlimited" if r["capacity"] is None else f"{r['capacity']:.1%}"
        return (f"| {cap} | {r['margin']:.0%} | {v['review_t']:.3f} | {min(v['decline_t'], 1):.3f} | "
                f"{h['reviews_per_day']:,.0f} / {h['declines']:,} | {h['recall']:.1%} | {h['fpr']:.2%} | ${h['net']:,.0f} |")

    header = ["| Analyst capacity | Margin | Review ≥ | Decline ≥ | Holdout reviews per day / declines | Holdout recall | Holdout FPR | Holdout net $ |",
              "|---|---|---|---|---|---|---|---|"]
    body = "\n".join([
        "## Operating point chosen by cost, within analyst capacity",
        "",
        f"Generated by [`ml/costs.py`](../ml/costs.py) on `{source}`" + (" (synthetic development sample, not results)." if sample else "."),
        f"net = fraud $ blocked − reviews × ${COST_PER_REVIEW:.0f} − good-customer $ declined × margin. "
        f"Capacity is the largest share of daily transactions analysts can review; auto-declines are capped at {MAX_DECLINE_SHARE:.0%} "
        "of transactions. Thresholds are picked on the validation "
        "slice within it, then reported once on the holdout "
        f"({len(ho) / days_ho:,.0f} transactions per day). A decline threshold of 1.000 means nothing is auto-declined.",
        "",
        *header, *[line(r) for r in rows], line(doubled),
        "",
        "![Net dollars vs analyst capacity](img/cost_curve.png)",
    ])
    upsert_section("costs", body)
    h = base["holdout"]
    upsert_section("operating-point", "\n".join([
        "### Operating point (dollars, within analyst capacity)",
        "",
        f"Analysts can review {ANALYST_CAPACITY_SHARE:.0%} of daily transactions and at most {MAX_DECLINE_SHARE:.0%} are auto-declined. Within that, review at model score ≥ {op['review_t']:.3f} "
        f"and decline at ≥ {min(op['decline_t'], 1):.3f}, picked on the validation slice to maximize net dollars at "
        f"${COST_PER_REVIEW:.0f} per review and {MARGIN:.0%} margin. On the holdout: {h['reviews_per_day']:,.0f} reviews per day, "
        f"recall {h['recall']:.1%}, false-positive rate {h['fpr']:.2%}, net ${h['net']:,.0f}. "
        "Other capacities and a doubled margin are in [docs/results.md](docs/results.md). Produced by [`ml/costs.py`](ml/costs.py)"
        + (" on the synthetic development sample (not results)." if sample else "."),
        "",
        "![Net dollars vs analyst capacity](docs/img/cost_curve.png)",
    ]), README)
    print(body)


if __name__ == "__main__":
    main()
