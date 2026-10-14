"""Choose review and decline thresholds by dollars, not by a default 0.5.

For every pair (review_t <= decline_t) on a grid of validation-score quantiles:

  net = fraud_amt_blocked - reviews * cost_per_review - legit_amt_declined * margin

where a score >= decline_t is declined, review_t <= score < decline_t goes to an
analyst (who stops the fraud), and the rest is approved. The pair that maximizes
net dollars on the validation slice is the operating point; it is then reported
once on the holdout. The same search is repeated with the margin doubled.

Writes ml/artifacts/thresholds.json (read by the API), docs/img/cost_curve.png,
and a section of docs/results.md.

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

from assumptions import COST_PER_REVIEW, MARGIN  # noqa: E402
from dataset import ARTIFACTS, ROOT, encode, load_table, save_json, train_valid_split  # noqa: E402
from results_md import README, upsert_section  # noqa: E402


def evaluate_pair(s, y, amt, review_t, decline_t, cost_per_review, margin) -> dict:
    declined = s >= decline_t
    reviewed = (s >= review_t) & ~declined
    fraud = y == 1
    fraud_blocked = amt[(declined | reviewed) & fraud].sum()
    legit_declined = amt[declined & ~fraud].sum()
    n_reviews = int(reviewed.sum())
    net = fraud_blocked - n_reviews * cost_per_review - legit_declined * margin
    flagged = declined | reviewed
    return {
        "review_t": float(review_t), "decline_t": float(decline_t), "net": float(net),
        "fraud_blocked": float(fraud_blocked), "legit_declined": float(legit_declined),
        "reviews": n_reviews, "declines": int(declined.sum()),
        "recall": float((flagged & fraud).sum() / max(1, fraud.sum())),
        "fpr": float((flagged & ~fraud).sum() / max(1, (~fraud).sum())),
    }


def search(s, y, amt, cost_per_review, margin, grid):
    best, curve = None, []
    for r in grid:
        best_for_r = None
        for d in grid:
            if d < r:
                continue
            res = evaluate_pair(s, y, amt, r, d, cost_per_review, margin)
            if best_for_r is None or res["net"] > best_for_r["net"]:
                best_for_r = res
        curve.append(best_for_r)
        if best is None or best_for_r["net"] > best["net"]:
            best = best_for_r
    return best, curve


def main() -> None:
    spec = json.loads((ARTIFACTS / "feature_spec.json").read_text())
    model = lgb.Booster(model_file=str(ARTIFACTS / "model.txt"))
    df = load_table()
    _, va = train_valid_split(df[df.part == "train"])
    ho = df[df.part == "holdout"]
    s_va, s_ho = model.predict(encode(va, spec)), model.predict(encode(ho, spec))
    y_va, y_ho = va.isFraud.to_numpy(), ho.isFraud.to_numpy()
    a_va, a_ho = va.TransactionAmt.to_numpy(), ho.TransactionAmt.to_numpy()

    grid = np.unique(np.concatenate([np.quantile(s_va, np.linspace(0.5, 1, 151)), [1.0 + 1e-9]]))
    results = {}
    for label, margin in (("base", MARGIN), ("margin_x2", 2 * MARGIN)):
        best, curve = search(s_va, y_va, a_va, COST_PER_REVIEW, margin, grid)
        hold = evaluate_pair(s_ho, y_ho, a_ho, best["review_t"], best["decline_t"], COST_PER_REVIEW, margin)
        results[label] = {"margin": margin, "validation": best, "holdout": hold, "curve": curve}

    op = results["base"]["validation"]
    save_json("thresholds.json", {"review_threshold": op["review_t"], "decline_threshold": op["decline_t"],
                                  "cost_per_review": COST_PER_REVIEW, "margin": MARGIN})

    img = ROOT / "docs/img"
    img.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(7, 4))
    for label, color in (("base", "#2563eb"), ("margin_x2", "#d97706")):
        c = results[label]["curve"]
        ax.plot([p["review_t"] for p in c], [p["net"] for p in c], color=color,
                label=f"margin {results[label]['margin']:.0%}")
        b = results[label]["validation"]
        ax.scatter([b["review_t"]], [b["net"]], color=color, zorder=3)
    ax.set_xlabel("review threshold (best decline threshold for each)")
    ax.set_ylabel("net dollars on validation")
    ax.set_title(f"Net dollars vs review threshold (${COST_PER_REVIEW:.0f} per review)")
    ax.grid(alpha=0.3)
    ax.legend(frameon=False)
    fig.tight_layout()
    fig.savefig(img / "cost_curve.png", dpi=150)

    source = (ROOT / "data/clean/source.txt").read_text().strip()
    rows = []
    for label in ("base", "margin_x2"):
        r = results[label]
        v, h = r["validation"], r["holdout"]
        rows.append(f"| {r['margin']:.0%} | {v['review_t']:.3f} | {min(v['decline_t'], 1):.3f} | ${v['net']:,.0f} | "
                    f"${h['net']:,.0f} | {h['reviews']:,} / {h['declines']:,} | {h['recall']:.1%} | {h['fpr']:.2%} |")
    body = "\n".join([
        "## Operating point chosen by cost",
        "",
        f"Generated by [`ml/costs.py`](../ml/costs.py) on `{source}`"
        + (" (synthetic development sample, not results)." if "sample" in source else "."),
        f"net = fraud $ blocked − reviews × ${COST_PER_REVIEW:.0f} − good-customer $ declined × margin. "
        "Thresholds are picked on the validation slice, then reported once on the holdout. "
        "A decline threshold of 1.000 means nothing is auto-declined.",
        "",
        "| Margin | Review threshold | Decline threshold | Net $ (validation) | Net $ (holdout) | Holdout reviews / declines | Holdout recall | Holdout FPR |",
        "|---|---|---|---|---|---|---|---|",
        *rows,
        "",
        "![Cost curve](img/cost_curve.png)",
    ])
    upsert_section("costs", body)
    h = results["base"]["holdout"]
    upsert_section("operating-point", "\n".join([
        "### Operating point (chosen by dollars)",
        "",
        f"Review at model score ≥ {op['review_t']:.3f}, decline at ≥ {min(op['decline_t'], 1):.3f}, picked on the validation slice "
        f"to maximize net dollars at ${COST_PER_REVIEW:.0f} per review and {MARGIN:.0%} margin. "
        f"On the holdout: net ${h['net']:,.0f}, recall {h['recall']:.1%}, false-positive rate {h['fpr']:.2%}. "
        "Doubling the margin assumption is in [docs/results.md](docs/results.md). Produced by [`ml/costs.py`](ml/costs.py)"
        + (" on the synthetic development sample (not results)." if "sample" in source else "."),
        "",
        "![Net dollars vs review threshold](docs/img/cost_curve.png)",
    ]), README)
    print(body)


if __name__ == "__main__":
    main()
