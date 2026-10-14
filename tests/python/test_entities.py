import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "prep"))
from entities import card_entity, device_entity  # noqa: E402


def test_fixture_still_matches_python():
    cases = json.loads((ROOT / "server/test/fixtures/entity_parity.json").read_text())
    for c in cases:
        assert card_entity(c["row"]) == c["card_entity"]
        assert device_entity(c["row"]) == c["device_entity"]


def test_edge_cases():  # same literals as server/test/entityParity.test.ts
    assert card_entity({"card1": 13926, "addr1": 315, "TransactionDT": 86400, "D1": 14}) == "13926|315|-13"
    assert card_entity({"card1": 13926.0, "addr1": float("nan"), "TransactionDT": 86400, "D1": None}) == "13926|NA|NA"
    assert card_entity({"card1": 2755, "addr1": 330.0, "TransactionDT": 1_000_000, "D1": 0.5}) == "2755|330|11"
    assert device_entity({"DeviceInfo": None, "id_30": "iOS 11", "id_31": None, "id_33": None}) is None
    assert device_entity({"DeviceInfo": "Windows", "id_30": "Windows 10", "id_31": None, "id_33": "1920x1080"}) == \
        "Windows|Windows 10|NA|1920x1080"
