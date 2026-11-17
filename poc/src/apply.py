"""사람이 확인한 정리 결과(레코드)를 재고·생산일정에 반영하고, 발주 초안이 어떻게 달라졌는지 비교한다.

레코드는 STT + LLM 정리 단계의 출력이다. 두 종류만 다룬다 (문제 정의서 §5.1).

    {"kind": "stock_report", "materialId": "C", "qty": 2000}
        → 부자재 C의 현재 재고를 2,000으로 바꾼다. qty는 낱개 수량이다
          ("두 롤"처럼 포장 단위로 들은 값은 정리 단계에서 입수량을 곱해 낱개로 바꿔 둔다)

    {"kind": "schedule_change", "project": "P2", "startDate": "2026-11-17", "productionQty": 150}
        → 프로젝트 P2의 생산시작일·생산수량을 바꾼다. 둘 중 말한 것만 넣는다
"""

from __future__ import annotations

import copy

from .order_plan import is_valid_iso_date

KINDS = ("stock_report", "schedule_change")


class RecordError(ValueError):
    """반영할 수 없는 레코드. 정리 단계에서 "확인 필요"로 걸러졌어야 하는 경우다"""


def apply_records(plan_input: dict, records: list[dict]) -> dict:
    """plan_input을 고치지 않고, 레코드를 반영한 새 입력을 돌려준다. 하나라도 잘못되면 아무것도 반영하지 않는다"""
    result = copy.deepcopy(plan_input)
    materials = {m["id"]: m for m in result["materials"]}
    projects = {}
    for p in result["projects"]:
        projects[p["id"]] = p
        projects.setdefault(p["name"], p)

    for i, r in enumerate(records, start=1):
        kind = r.get("kind")
        if kind == "stock_report":
            material = materials.get(r.get("materialId"))
            if material is None:
                raise RecordError(f"{i}번째: 부자재 목록에 없는 코드입니다 ({r.get('materialId')})")
            qty = r.get("qty")
            if isinstance(qty, bool) or not isinstance(qty, (int, float)) or qty < 0:
                raise RecordError(f"{i}번째: 재고 수량이 올바르지 않습니다 ({qty})")
            material["stockQty"] = qty
        elif kind == "schedule_change":
            project = projects.get(r.get("project"))
            if project is None:
                raise RecordError(f"{i}번째: 프로젝트를 찾을 수 없습니다 ({r.get('project')})")
            start, qty = r.get("startDate"), r.get("productionQty")
            if start is None and qty is None:
                raise RecordError(f"{i}번째: 바꿀 생산시작일이나 생산수량이 없습니다")
            if start is not None:
                if not is_valid_iso_date(start):
                    raise RecordError(f"{i}번째: 생산시작일이 올바르지 않습니다 ({start})")
                project["startDate"] = start
            if qty is not None:
                if isinstance(qty, bool) or not isinstance(qty, (int, float)) or qty <= 0:
                    raise RecordError(f"{i}번째: 생산수량이 올바르지 않습니다 ({qty})")
                project["productionQty"] = qty
        else:
            raise RecordError(f"{i}번째: 알 수 없는 종류입니다 ({kind})")
    return result


def order_signature(plan: dict) -> list[tuple]:
    """발주 판단을 비교할 때 쓰는 값: (부자재, 발주일, 발주수량). 발주 판단 일치율(S3)이 이것으로 계산된다"""
    return sorted((o["materialId"], o["orderDate"], o["orderQty"]) for o in plan["orders"])


def diff_plans(before: dict, after: dict) -> list[dict]:
    """부자재별로 발주(발주일, 발주수량)가 어떻게 달라졌는지. 달라진 부자재만 돌려준다"""
    def per_material(plan: dict) -> dict[str, list[tuple]]:
        grouped: dict[str, list[tuple]] = {}
        for o in sorted(plan["orders"], key=lambda o: o["orderDate"]):
            grouped.setdefault(o["materialId"], []).append((o["orderDate"], o["orderQty"]))
        return grouped

    b, a = per_material(before), per_material(after)
    changes = []
    for material_id in sorted(b.keys() | a.keys()):
        old, new = b.get(material_id, []), a.get(material_id, [])
        if old == new:
            continue
        change = "new" if not old else "removed" if not new else "changed"
        changes.append({"materialId": material_id, "change": change, "before": old, "after": new})
    return changes
