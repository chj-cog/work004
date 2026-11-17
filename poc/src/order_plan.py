"""발주 계산 — 웹 앱의 계산 엔진(src/engine/plan.ts, calendar.ts)을 파이썬으로 옮긴 것.

Colab 노트북 하나로 끝까지 재현할 수 있게 하려고 옮겼다. 규칙은 PRD §6과 같다.
입력과 출력은 TypeScript 엔진과 같은 모양의 dict(camelCase 키)라서, 같은 입력에 같은 답이
나오는지 tests/test_engine_parity.py 에서 비교한다.
"""

from __future__ import annotations

import math
import re
from datetime import date, timedelta
from typing import Any, Iterable

DEFAULT_SETTINGS = {"bufferBdays": 3, "imminentBdays": 3, "mergeWindowBdays": 5}

_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_STATUS_RANK = {"overdue": 0, "imminent": 1, "scheduled": 2}


def is_valid_iso_date(value: Any) -> bool:
    if not isinstance(value, str) or not _ISO_RE.match(value):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


class BusinessCalendar:
    """영업일 = 월~금 중 휴일 목록에 없는 날. 날짜는 'YYYY-MM-DD' 문자열로 주고받는다."""

    def __init__(self, holidays: Iterable[str] = ()):
        self._holidays = {date.fromisoformat(h) for h in holidays}

    def _is_bd(self, d: date) -> bool:
        return d.weekday() < 5 and d not in self._holidays

    def _step(self, value: str, n: int, direction: int) -> str:
        if n < 0 or int(n) != n:
            raise ValueError(f"영업일 수는 0 이상의 정수여야 합니다: {n}")
        d = date.fromisoformat(value)
        left = int(n)
        while left > 0:
            d += timedelta(days=direction)
            if self._is_bd(d):
                left -= 1
        return d.isoformat()

    def is_business_day(self, value: str) -> bool:
        return self._is_bd(date.fromisoformat(value))

    def subtract_business_days(self, value: str, n: int) -> str:
        """value에서 앞으로(과거로) 영업일을 n개 센 날"""
        return self._step(value, n, -1)

    def add_business_days(self, value: str, n: int) -> str:
        """value에서 뒤로(미래로) 영업일을 n개 센 날"""
        return self._step(value, n, 1)

    def business_days_between(self, start: str, end: str) -> int:
        """start 다음 날부터 end까지의 영업일 수. end가 더 이르면 음수"""
        a, b = date.fromisoformat(start), date.fromisoformat(end)
        if b < a:
            return -self.business_days_between(end, start)
        count, d = 0, a
        while d < b:
            d += timedelta(days=1)
            if self._is_bd(d):
                count += 1
        return count

    def previous_business_day(self, value: str) -> str:
        """value가 영업일이면 그대로, 아니면 직전 영업일"""
        d = date.fromisoformat(value)
        while not self._is_bd(d):
            d -= timedelta(days=1)
        return d.isoformat()


def _round_qty(x: float) -> float | int:
    """소수 소요량(0.1 등)의 부동소수점 오차를 없앤다. 정수면 int로 돌려준다"""
    r = math.floor(x * 1e6 + 0.5) / 1e6
    return int(r) if r == int(r) else r


def _round_up_to_unit(qty: float, unit: float) -> float | int:
    return _round_qty(math.ceil(_round_qty(qty / unit)) * unit)


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def calculate_plan(inp: dict) -> dict:
    """PlanInput(dict) → {"orders": [...], "issues": [...]}. orders는 지남 → 임박 → 예정, 발주일 순"""
    today = inp["today"]
    if not is_valid_iso_date(today):
        raise ValueError(f"잘못된 기준일: {today}")
    settings = {**DEFAULT_SETTINGS, **(inp.get("settings") or {})}
    issues: list[dict] = []

    raw_holidays = inp.get("holidays") or []
    for h in raw_holidays:
        if not is_valid_iso_date(h):
            issues.append({"level": "warning", "code": "INVALID_DATE", "message": f"잘못된 휴일 날짜 무시: {h}"})
    cal = BusinessCalendar(h for h in raw_holidays if is_valid_iso_date(h))

    projects = _validate_projects(inp, cal, issues)
    materials = _validate_materials(inp["materials"], issues)

    open_qty: dict[str, float] = {}
    for o in inp.get("openOrders") or []:
        open_qty[o["materialId"]] = open_qty.get(o["materialId"], 0) + o["qty"]

    drafts: list[dict] = []
    for m in materials:
        demands = _collect_demands(m, projects, inp["bomItems"], cal, settings)
        if not demands:
            continue
        drafts.extend(_plan_material(m, demands, m["stockQty"] + open_qty.get(m["id"], 0), cal, settings))

    lead_time = {m["id"]: m["leadTimeBdays"] for m in materials}
    orders = [_finalize(d, today, cal, settings, lead_time) for d in drafts]
    orders.sort(key=lambda o: (_STATUS_RANK[o["status"]], o["orderDate"], o["materialId"]))

    if inp.get("holidayYears") is not None:
        loaded = set(inp["holidayYears"])
        used = {int(today[:4])} | {int(p["startDate"][:4]) for p in projects} | {int(o["orderDate"][:4]) for o in orders}
        for y in sorted(used):
            if y not in loaded:
                issues.append({"level": "warning", "code": "HOLIDAYS_MISSING", "message": f"{y}년 공휴일 미수신 — 발주일이 실제보다 늦게 잡힐 수 있습니다"})

    return {"orders": orders, "issues": issues}


def _validate_projects(inp: dict, cal: BusinessCalendar, issues: list[dict]) -> list[dict]:
    products_with_bom = {b["productId"] for b in inp["bomItems"]}
    result = []
    for p in inp["projects"]:
        if p["status"] not in ("planned", "in_progress"):
            continue

        def err(code: str, message: str) -> None:
            issues.append({"level": "error", "code": code, "projectId": p["id"], "message": f"{p['name']}: {message}"})

        if not is_valid_iso_date(p["startDate"]):
            err("INVALID_DATE", f"생산시작일이 올바르지 않습니다 ({p['startDate']})")
            continue
        if not (_is_number(p["productionQty"]) and p["productionQty"] > 0):
            err("INVALID_PRODUCTION_QTY", "생산수량은 0보다 커야 합니다")
            continue
        if p["productId"] not in products_with_bom:
            err("BOM_MISSING", f"제품 {p['productId']}의 BOM이 등록되지 않았습니다")
            continue
        if not cal.is_business_day(p["startDate"]):
            issues.append({
                "level": "warning", "code": "START_ON_HOLIDAY", "projectId": p["id"],
                "message": f"{p['name']}: 생산시작일({p['startDate']})이 휴일입니다. 직전 영업일 기준으로 계산합니다",
            })
        result.append(p)

    material_ids = {m["id"] for m in inp["materials"]}
    for b in inp["bomItems"]:
        if b["materialId"] not in material_ids:
            issues.append({
                "level": "error", "code": "UNKNOWN_MATERIAL", "materialId": b["materialId"],
                "message": f"제품 {b['productId']}의 BOM에 등록되지 않은 부자재 {b['materialId']}가 있습니다",
            })
    return result


def _validate_materials(materials: list[dict], issues: list[dict]) -> list[dict]:
    result = []
    for m in materials:
        def err(code: str, message: str) -> None:
            issues.append({"level": "error", "code": code, "materialId": m["id"], "message": f"{m['name']}: {message}"})

        lt = m["leadTimeBdays"]
        if not (_is_number(m["orderUnit"]) and m["orderUnit"] > 0):
            err("INVALID_ORDER_UNIT", "발주 단위는 0보다 커야 합니다")
        elif not (_is_number(lt) and float(lt).is_integer() and lt >= 0):
            err("INVALID_LEAD_TIME", "리드타임은 0 이상의 정수(영업일)여야 합니다")
        elif m.get("moq") is not None and not (_is_number(m["moq"]) and m["moq"] >= 0):
            err("INVALID_MOQ", "최소 발주수량은 0 이상이어야 합니다")
        elif not (_is_number(m["stockQty"]) and m["stockQty"] >= 0):
            err("INVALID_STOCK", "현재 재고는 0 이상이어야 합니다")
        else:
            result.append(m)
    return result


def _collect_demands(material: dict, projects: list[dict], bom_items: list[dict], cal: BusinessCalendar, settings: dict) -> list[dict]:
    per_unit: dict[str, float] = {}
    for b in bom_items:
        if b["materialId"] == material["id"]:
            per_unit[b["productId"]] = per_unit.get(b["productId"], 0) + b["qtyPerUnit"]

    demands = []
    for p in projects:
        q = per_unit.get(p["productId"])
        if not q:
            continue
        required = _round_qty(p["productionQty"] * q)
        if required <= 0:
            continue
        # 생산시작일이 휴일이면 직전 영업일을 발주일 역산의 기준으로 삼는다
        effective_start = cal.previous_business_day(p["startDate"])
        demands.append({
            "projectId": p["id"],
            "requiredQty": required,
            "startDate": p["startDate"],
            "orderDate": cal.subtract_business_days(effective_start, int(material["leadTimeBdays"]) + settings["bufferBdays"]),
        })
    demands.sort(key=lambda d: (d["startDate"], d["projectId"]))
    return demands


def _plan_material(material: dict, demands: list[dict], initial_pool: float, cal: BusinessCalendar, settings: dict) -> list[dict]:
    """생산시작일이 빠른 프로젝트부터 재고를 배정하고, 부족하면 발주를 만든다.

    발주가 생기면 그 발주일부터 합치기 기간 안에 발주일이 드는 프로젝트를 한 발주로 묶고,
    묶은 부족수량 합(또는 MOQ)을 발주 단위로 올린다. 남는 수량은 다음 프로젝트로 넘어간다.
    """
    unit, moq = material["orderUnit"], material.get("moq") or 0
    result: list[dict] = []
    pool = initial_pool
    last: dict | None = None
    i = 0

    while i < len(demands):
        first = demands[i]

        if pool >= first["requiredQty"]:
            pool = _round_qty(pool - first["requiredQty"])
            # 앞 발주의 남은 수량으로 충당되면 그 발주의 사용 프로젝트에 붙인다
            if last is not None:
                last["allocations"].append({"projectId": first["projectId"], "requiredQty": first["requiredQty"], "fromStockQty": 0, "fromOrderQty": first["requiredQty"]})
                last["projectIds"].append(first["projectId"])
                last["remainingAfterQty"] = pool
            i += 1
            continue

        group = [first]
        j = i + 1
        while j < len(demands) and cal.business_days_between(first["orderDate"], demands[j]["orderDate"]) <= settings["mergeWindowBdays"]:
            group.append(demands[j])
            j += 1

        group_demand = _round_qty(sum(d["requiredQty"] for d in group))
        shortage = _round_qty(group_demand - pool)
        without_moq = _round_up_to_unit(shortage, unit)
        order_qty = _round_up_to_unit(max(shortage, moq), unit)

        pool_left = pool
        allocations = []
        for d in group:
            from_stock = min(pool_left, d["requiredQty"])
            pool_left = _round_qty(pool_left - from_stock)
            allocations.append({"projectId": d["projectId"], "requiredQty": d["requiredQty"], "fromStockQty": _round_qty(from_stock), "fromOrderQty": _round_qty(d["requiredQty"] - from_stock)})

        pool = _round_qty(pool + order_qty - group_demand)
        last = {
            "materialId": material["id"],
            "orderDate": first["orderDate"],
            "orderQty": order_qty,
            "expectedArrivalDate": cal.add_business_days(first["orderDate"], int(material["leadTimeBdays"])),
            "remainingAfterQty": pool,
            "moqApplied": order_qty > without_moq,
            "projectIds": [d["projectId"] for d in group],
            "allocations": allocations,
            "_firstStartDate": first["startDate"],
        }
        result.append(last)
        i = j
    return result


def _finalize(draft: dict, today: str, cal: BusinessCalendar, settings: dict, lead_time: dict[str, int]) -> dict:
    order = {k: v for k, v in draft.items() if not k.startswith("_")}
    if order["orderDate"] < today:
        status = "overdue"
    elif cal.business_days_between(today, order["orderDate"]) <= settings["imminentBdays"]:
        status = "imminent"
    else:
        status = "scheduled"

    arrival_if_today, delay_risk = None, False
    if status == "overdue":
        arrival_if_today = cal.add_business_days(today, int(lead_time[order["materialId"]]))
        # 생산시작일 당일 입고도 늦은 것으로 본다
        delay_risk = arrival_if_today >= draft["_firstStartDate"]
    return {**order, "status": status, "arrivalIfOrderedToday": arrival_if_today, "delayRisk": delay_risk}
