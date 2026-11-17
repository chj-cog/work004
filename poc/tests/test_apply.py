import copy
import json
from pathlib import Path

import pytest

from src.apply import RecordError, apply_records, diff_plans, order_signature
from src.order_plan import calculate_plan

BASE = json.loads((Path(__file__).parents[1] / "data" / "scenario" / "base.json").read_text(encoding="utf-8"))


def test_stock_report_removes_an_order():
    """ "라벨 재고 2,600개 있어요" → 라벨 발주가 사라진다 (필요 2,600 ≤ 재고)"""
    before = calculate_plan(BASE)
    after = calculate_plan(apply_records(BASE, [{"kind": "stock_report", "materialId": "C", "qty": 2600}]))
    assert diff_plans(before, after) == [{"materialId": "C", "change": "removed", "before": [("2026-11-05", 3000)], "after": []}]


def test_schedule_change_moves_and_grows_orders():
    """ "P2 11월 17일로 당겨지고 150개로 늘었어요" → P2가 쓰는 나사·라벨 발주가 바뀐다"""
    before = calculate_plan(BASE)
    changed = apply_records(BASE, [{"kind": "schedule_change", "project": "P2", "startDate": "2026-11-17", "productionQty": 150}])
    after = calculate_plan(changed)
    assert {c["materialId"] for c in diff_plans(before, after)} == {"A", "C"}
    assert ("B", "2026-11-02", 1500) in order_signature(after)  # P2가 쓰지 않는 포장박스는 그대로


def test_input_is_not_mutated():
    original = copy.deepcopy(BASE)
    apply_records(BASE, [{"kind": "stock_report", "materialId": "A", "qty": 0}])
    assert BASE == original


@pytest.mark.parametrize(
    "record",
    [
        {"kind": "stock_report", "materialId": "ZZ", "qty": 10},
        {"kind": "stock_report", "materialId": "A", "qty": -1},
        {"kind": "stock_report", "materialId": "A", "qty": "두 롤"},
        {"kind": "schedule_change", "project": "P9", "productionQty": 10},
        {"kind": "schedule_change", "project": "P1"},
        {"kind": "schedule_change", "project": "P1", "startDate": "다음 주 화요일"},
        {"kind": "order_request", "materialId": "A", "qty": 800},
    ],
)
def test_bad_records_are_rejected(record):
    with pytest.raises(RecordError):
        apply_records(BASE, [record])


def test_nothing_is_applied_when_one_record_is_bad():
    good = {"kind": "stock_report", "materialId": "A", "qty": 0}
    bad = {"kind": "stock_report", "materialId": "ZZ", "qty": 1}
    with pytest.raises(RecordError):
        apply_records(BASE, [good, bad])
    assert BASE["materials"][0]["stockQty"] == 500
