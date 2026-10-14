# FraudGraph

Real-time payment fraud and identity-ring detection on the IEEE-CIS (Vesta) e-commerce transaction dataset.

Every incoming transaction gets an **approve / review / decline** decision within a latency budget, with human-readable reasons. Signals are checked cheapest first:

1. Bloom-filter blocklist
2. Sliding-window velocity rules
3. Identity graph (union-find rings with a supernode cap)
4. LightGBM risk score served via ONNX

> Work in progress. Results, architecture diagram and setup instructions will be added as each stage lands.

## Data

The raw dataset is not included in this repository. See the IEEE-CIS Fraud Detection competition on Kaggle for terms and download. All data lives under `data/`, which is git-ignored.

## License

MIT
