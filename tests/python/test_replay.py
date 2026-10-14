import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "replay"))
from replay import API_FIELDS, to_body  # noqa: E402


def test_label_is_never_sent():
    assert "isFraud" not in API_FIELDS


def test_nan_becomes_null_and_ids_are_ints():
    body = to_body({"TransactionID": 2987000.0, "TransactionDT": 86400.0, "TransactionAmt": 10.5, "addr1": math.nan})
    assert body == {"TransactionID": 2987000, "TransactionDT": 86400, "TransactionAmt": 10.5, "addr1": None}
