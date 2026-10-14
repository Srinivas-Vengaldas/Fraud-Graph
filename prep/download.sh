#!/usr/bin/env bash
# Download the IEEE-CIS Fraud Detection data from Kaggle into data/raw.
# Prerequisites: accept the competition rules on kaggle.com and save your API
# token as ~/.kaggle/kaggle.json (never commit it).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw
cd data/raw
kaggle competitions download -c ieee-fraud-detection
unzip -o ieee-fraud-detection.zip
ls -lh *.csv
