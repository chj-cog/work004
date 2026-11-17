"""PRD의 예시가 문서의 숫자와 같게 나오는지 확인한다 (PRD §4.1, §6.4, §6.5)."""

import copy
import json
from pathlib import Path

import pytest

from src.order_plan import BusinessCalendar, calculate_plan, is_valid_iso_date

BASE = json.loads((Path(__file__).parents[1] / "data" / "scenario" / "base.json").read_text(encoding="utf-8"))


@pytest.fixture
def base():
    return copy.deepcopy(BASE)


def by_material(result, material_id):
    return [o for o in result["orders"] if o["materialId"] == material_id]


def test_calendar_skips_weekends_and_holidays():
    cal = BusinessCalendar(["2026-11-12", "2026-11-13"])
    assert cal.subtract_business_days("2026-11-20", 9) == "2026-11-05"
    assert cal.add_business_days("2026-11-05", 6) == "2026-11-17"
    assert cal.add_business_days("2026-11-07", 1) == "2026-11-09"  # 토요일에서 1영업일 뒤 = 월
    assert cal.business_days_between("2026-11-11", "2026-11-16") == 1
    assert cal.business_days_between("2026-11-11", "2026-11-09") == -2
    assert cal.previous_business_day("2026-11-15") == "2026-11-11"
    assert not is_valid_iso_date("2026-02-30")


def test_prd_checklist_example(base):
    """§4.1: 지남 → 임박 → 예정 순서와 각 줄의 값"""
    result = calculate_plan(base)
    assert result["issues"] == []
    assert [(o["materialId"], o["status"]) for o in result["orders"]] == [
        ("B", "overdue"), ("C", "imminent"), ("A", "scheduled"), ("D", "scheduled"),
    ]
    b, c, a, d = result["orders"]
    assert (b["orderDate"], b["orderQty"], b["expectedArrivalDate"], b["remainingAfterQty"]) == ("2026-11-02", 1500, "2026-11-17", 200)
    assert (b["arrivalIfOrderedToday"], b["delayRisk"]) == ("2026-11-18", False)
    assert (c["orderDate"], c["orderQty"], c["remainingAfterQty"], c["projectIds"]) == ("2026-11-05", 3000, 400, ["P1", "P2"])
    # §6.4: 나사는 발주일 간격 2영업일이라 한 발주로 합친다
    assert (a["orderDate"], a["orderQty"], a["remainingAfterQty"], a["moqApplied"]) == ("2026-11-09", 2400, 300, False)
    assert a["allocations"] == [
        {"projectId": "P1", "requiredQty": 1700, "fromStockQty": 500, "fromOrderQty": 1200},
        {"projectId": "P2", "requiredQty": 900, "fromStockQty": 0, "fromOrderQty": 900},
    ]
    # §6.5: 완충재는 부족 700이지만 MOQ 2,000
    assert (d["orderQty"], d["moqApplied"], d["remainingAfterQty"]) == (2000, True, 1300)


def test_orders_stay_separate_beyond_merge_window(base):
    base["projects"][1]["startDate"] = "2026-12-01"
    a = by_material(calculate_plan(base), "A")
    assert [(o["orderDate"], o["orderQty"], o["remainingAfterQty"]) for o in a] == [("2026-11-09", 1600, 400), ("2026-11-18", 800, 300)]


def test_stock_covers_everything(base):
    base["materials"][0]["stockQty"] = 2600
    assert by_material(calculate_plan(base), "A") == []


def test_open_orders_count_as_incoming_stock(base):
    base["openOrders"] = [{"materialId": "A", "qty": 1200}]
    a = by_material(calculate_plan(base), "A")
    assert [(o["projectIds"], o["orderQty"], o["remainingAfterQty"]) for o in a] == [(["P2"], 1600, 700)]


def test_fractional_usage_does_not_round_up_an_extra_unit(base):
    base["materials"] = [{"id": "T", "name": "테이프", "orderUnit": 100, "moq": None, "leadTimeBdays": 2, "stockQty": 0}]
    base["bomItems"] = [{"productId": "X", "materialId": "T", "qtyPerUnit": 0.1}]
    base["projects"] = [{"id": "P1", "name": "P1", "productId": "X", "productionQty": 1000, "startDate": "2026-11-20", "status": "planned"}]
    (order,) = calculate_plan(base)["orders"]
    assert (order["orderQty"], order["remainingAfterQty"]) == (100, 0)


def test_delay_risk_when_ordering_today_is_too_late(base):
    base["materials"][1]["leadTimeBdays"] = 14
    (b,) = by_material(calculate_plan(base), "B")
    assert (b["status"], b["orderDate"], b["arrivalIfOrderedToday"], b["delayRisk"]) == ("overdue", "2026-10-28", "2026-11-23", True)


def test_input_errors_are_reported(base):
    base["materials"][0]["orderUnit"] = 0
    base["projects"].append({"id": "P9", "name": "P9", "productId": "NONE", "productionQty": 10, "startDate": "2026-11-20", "status": "planned"})
    result = calculate_plan(base)
    assert [(i["code"], i.get("projectId") or i.get("materialId")) for i in result["issues"]] == [("BOM_MISSING", "P9"), ("INVALID_ORDER_UNIT", "A")]
    assert by_material(result, "A") == []
