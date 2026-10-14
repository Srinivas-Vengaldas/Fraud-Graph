import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "prep"))
from split import DAY, assign, compute_split  # noqa: E402


def test_gap_separates_train_and_holdout():
    dt = pd.Series([d * DAY + 10 for d in range(100)])
    split = compute_split(dt)
    part = assign(dt, split)
    day = dt // DAY
    assert day[part == "train"].max() < split["train_end_day"]
    assert day[part == "holdout"].min() == split["cutoff_day"]
    assert (part == "gap").sum() == split["gap_days"]
    assert day[part == "train"].max() + split["gap_days"] < day[part == "holdout"].min()
