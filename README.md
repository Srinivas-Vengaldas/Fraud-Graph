# FraudGraph

Real-time payment fraud and identity-ring detection on the IEEE-CIS (Vesta) e-commerce transaction dataset.

Every incoming transaction gets an **approve / review / decline** decision within a latency budget, with human-readable reasons. Signals are checked cheapest first:

1. Bloom-filter blocklist
2. Sliding-window velocity rules
3. Identity graph (union-find rings with a supernode cap)
4. LightGBM risk score served via ONNX

> Work in progress. Results, architecture diagram and setup instructions will be added as each stage lands.

## Results

All numbers are produced by scripts and collected in [docs/results.md](docs/results.md). Until the Kaggle data is downloaded they come from a synthetic development sample and are not results.

### Rules vs model

<!-- results-table:start -->
Holdout, equal review volume (908 reviews) on the synthetic development sample (not results). From [`ml/lift.py`](ml/lift.py); details in [docs/results.md](docs/results.md).

| Policy | Reviews / declines | Recall | False-positive rate | Fraud $ stopped | Good-customer $ declined | Net $ |
|---|---|---|---|---|---|---|
| Rules only | 908 / 27 | 70.6% | 5.17% | $48,660 | $0 | $44,120 |
| Model only | 908 / 299 | 86.4% | 6.82% | $59,729 | $2,797 | $54,910 |
| Rules + model | 908 / 318 | 80.6% | 7.13% | $57,266 | $2,797 | $52,446 |
<!-- results-table:end -->

<!-- operating-point:start -->
### Operating point (chosen by dollars)

Review at model score ≥ 0.053, decline at ≥ 0.947, picked on the validation slice to maximize net dollars at $5 per review and 10% margin. On the holdout: net $56,129, recall 85.6%, false-positive rate 4.53%. Doubling the margin assumption is in [docs/results.md](docs/results.md). Produced by [`ml/costs.py`](ml/costs.py) on the synthetic development sample (not results).

![Net dollars vs review threshold](docs/img/cost_curve.png)
<!-- operating-point:end -->

## Data

The raw dataset is not included in this repository. See the IEEE-CIS Fraud Detection competition on Kaggle for terms and download. All data lives under `data/`, which is git-ignored.

## License

MIT
