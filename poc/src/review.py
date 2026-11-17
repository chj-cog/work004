"""LLM이 뽑은 항목을 레코드로 바꾸고, 확정할 수 없으면 "확인 필요"를 붙인다.

역할 나누기: LLM은 글에서 "무엇을, 몇, 어떤 단위로, 언제"를 **뽑기만** 한다.
곱셈(2롤 → 2,000장)과 날짜 계산(다음 주 화요일 → 11월 10일)은 여기서 코드로 한다.
LLM은 계산을 자주 틀리고, 틀려도 그럴듯한 숫자를 내기 때문이다.

"확인 필요"가 붙는 경우
    목록에 없는 품목·프로젝트, 그 품목에 쓰지 않는 단위, 수량·날짜를 못 찾음,
    근거로 든 말이 글에 없음(지어냄), 발주 요청, LLM이 불확실하다고 표시함, 형식이 깨짐
"""

from __future__ import annotations

import re
from datetime import date, timedelta

from .korean_numbers import numbers_in

WEEKDAYS = "월화수목금토일"


def _squash(text: str) -> str:
    return re.sub(r"[\s.,!?~]", "", text)


def resolve_date(spec: dict, today: date, current_start: date | None) -> str | None:
    """LLM이 뽑은 날짜 표현을 실제 날짜로 바꾼다. 바꿀 수 없으면 ValueError"""
    form = spec.get("form", "none")
    if form == "none":
        return None
    if form == "shift":
        days = spec.get("shift_days")
        if not isinstance(days, int) or isinstance(days, bool) or days == 0 or current_start is None:
            raise ValueError("며칠을 옮기는지 알 수 없음")
        return (current_start + timedelta(days=days)).isoformat()
    if form == "weekday":
        week, weekday = spec.get("week"), spec.get("weekday")
        if week not in ("this", "next") or weekday not in tuple(WEEKDAYS):
            raise ValueError("어느 주의 무슨 요일인지 알 수 없음")
        monday = today - timedelta(days=today.weekday())
        return (monday + timedelta(days=(7 if week == "next" else 0) + WEEKDAYS.index(weekday))).isoformat()
    day = spec.get("day")
    if not isinstance(day, int) or isinstance(day, bool) or not 1 <= day <= 31:
        raise ValueError("날짜를 읽지 못함")
    try:
        if form == "month_day":
            month = spec.get("month")
            if not isinstance(month, int) or isinstance(month, bool) or not 1 <= month <= 12:
                raise ValueError("몇 월인지 읽지 못함")
            result = date(today.year, month, day)
            if result < today:
                result = date(today.year + 1, month, day)
        elif form == "day":  # 날만 말하면 오늘 이후 가장 가까운 그 날
            result = date(today.year, today.month, day)
            if result < today:
                year, month = (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
                result = date(year, month, day)
        else:
            raise ValueError(f"모르는 날짜 형식 ({form})")
    except ValueError as error:
        raise ValueError(str(error) if "읽지" in str(error) or "형식" in str(error) else "없는 날짜") from None
    return result.isoformat()


def _number(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
        return None
    return float(value)


def _spoken(value, spoken: set[float], has_half: bool) -> bool:
    """LLM이 적은 수가 글에 실제로 나온 수인지. "두 박스 반"의 2.5는 2가 있고 "반"이 있으면 인정한다"""
    if value is None:
        return True
    value = abs(float(value))
    return value in spoken or (has_half and value - 0.5 in spoken) or (value % 7 == 0 and value / 7 in spoken)


_DIGITS = re.compile(r"(?<![A-Za-z\d.,])\d[\d,]*(?:\.\d+)?")
_KEPT_AS_IS = re.compile(r"\d[\d,]*\s*[가-힣]{0,3}\s*(?:그대로|동일)")


def _edit_distance(a: str, b: str) -> int:
    previous = list(range(len(b) + 1))
    for i, x in enumerate(a, start=1):
        current = [i]
        for j, y in enumerate(b, start=1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (x != y)))
        previous = current
    return previous[-1]


def name_is_near(text: str, aliases: list[str]) -> bool:
    """글에 그 이름(또는 한 글자쯤 틀린 이름)이 있는지. "다사"는 나사로 보지만 "테이프"는 라벨로 보지 않는다"""
    source = _squash(text).lower()
    for alias in aliases:
        name = _squash(alias).lower()
        allowed = 0 if len(name) <= 1 else 1
        for size in {len(name), len(name) + 1, max(len(name) - 1, 1)}:
            for i in range(max(len(source) - size + 1, 0)):
                if _edit_distance(source[i:i + size], name) <= allowed:
                    return True
    return False


def to_records(extracted: dict, text: str, items: dict, scenario: dict, check_numbers: bool = False,
               strict: bool = False) -> dict:
    """LLM 출력({"entries": [...]}) → {"records", "needsReview", "reasons"}

    check_numbers: LLM이 적은 수가 글에 나온 수인지 확인한다. LLM이 "천이백"을 1300으로 읽는 식의 오류를 잡는다
    strict: 테스트 결과를 본 뒤에 더한 검사 (추가 시도). 글에 없는 단위, 글과 동떨어진 품목 이름,
            "한 박스 반"을 0.5로 읽은 경우, 글에 있는 수를 빠뜨린 경우를 "확인 필요"로 돌린다"""
    check_numbers = check_numbers or strict
    aliases = {m["id"]: m["aliases"] for m in items["materials"]}
    aliases.update({p["id"]: p["aliases"] for p in items["projects"]})
    digits = {float(d.replace(",", "")) for d in _DIGITS.findall(_KEPT_AS_IS.sub(" ", text))}
    used: set[float] = set()
    spoken = numbers_in(text) | {0.0}
    has_half = "반" in text
    today = date.fromisoformat(scenario["today"])
    starts = {p["id"]: date.fromisoformat(p["startDate"]) for p in scenario["projects"]}
    materials = {m["id"]: m for m in items["materials"]}
    projects = {p["id"] for p in items["projects"]}
    reasons: list[str] = []
    records: list[dict] = []
    seen: set[str] = set()
    source = _squash(text)

    entries = extracted.get("entries") if isinstance(extracted, dict) else None
    if not isinstance(entries, list) or not entries:
        return {"records": [], "needsReview": True, "reasons": ["뽑은 내용이 없음"]}

    for entry in entries:
        if not isinstance(entry, dict):
            reasons.append("형식이 맞지 않는 항목")
            continue
        kind, target = entry.get("type"), entry.get("target")
        evidence = entry.get("evidence") or ""
        if kind == "order_request":
            reasons.append("발주 요청으로 보임 (재고·일정 보고가 아님)")
            continue
        if kind == "unclear":
            reasons.append(f"불확실하다고 표시함: {evidence}")
            continue
        if not evidence or _squash(evidence) not in source:
            reasons.append(f"근거로 든 말이 글에 없음: {evidence!r}")
            continue
        if target in seen:
            reasons.append(f"{target}: 한 발화에서 두 번 나옴")
            continue
        seen.add(str(target))

        if check_numbers:
            spec = entry.get("date") if isinstance(entry.get("date"), dict) else {}
            amounts = entry.get("amounts") if isinstance(entry.get("amounts"), list) else []
            claimed = [a.get("number") for a in amounts if isinstance(a, dict)] + [entry.get("quantity")]
            form = spec.get("form")
            claimed += [spec.get("day")] if form in ("day", "month_day") else []
            claimed += [spec.get("month")] if form == "month_day" else []
            claimed += [spec.get("shift_days")] if form == "shift" else []
            wrong = [n for n in claimed if isinstance(n, (int, float)) and not isinstance(n, bool) and not _spoken(n, spoken, has_half)]
            if wrong:
                reasons.append(f"{target}: 글에 없는 수를 적음 ({', '.join(str(n) for n in wrong)})")
                continue
            for n in claimed:
                if isinstance(n, (int, float)) and not isinstance(n, bool):
                    used.update({abs(float(n)), abs(float(n)) - 0.5, abs(float(n)) / 7})

        if strict:
            if target in aliases and not name_is_near(text, aliases[target]):
                reasons.append(f"{target}: 글에 그 이름이 없음")
                continue
            problem = None
            for a in (entry.get("amounts") or []) if kind == "stock" else []:
                number, unit = (a.get("number"), a.get("unit")) if isinstance(a, dict) else (None, None)
                if not isinstance(number, (int, float)) or isinstance(number, bool) or number == 0:
                    continue
                if not unit or _squash(str(unit)) not in source:
                    problem = f"글에 없는 단위를 적음 ({unit})"
                elif number % 1 == 0.5 and number - 0.5 not in digits and not (number == 0.5 and not digits):
                    problem = f"'반'을 붙일 수가 글에 없음 ({number})"
            if problem:
                reasons.append(f"{target}: {problem}")
                continue

        if kind == "stock":
            material = materials.get(target)
            if material is None:
                reasons.append(f"부자재 목록에 없는 품목 ({target})")
                continue
            units = {u: 1 for u in material["baseUnits"]}
            units.update({p["unit"]: p["qty"] for p in material["packs"]})
            amounts = entry.get("amounts")
            if not isinstance(amounts, list) or not amounts:
                reasons.append(f"{material['name']}: 수량을 찾지 못함")
                continue
            total, ok = 0.0, True
            for amount in amounts:
                number = _number(amount.get("number")) if isinstance(amount, dict) else None
                unit = amount.get("unit") if isinstance(amount, dict) else None
                if number is None:
                    reasons.append(f"{material['name']}: 수량이 숫자가 아님")
                    ok = False
                elif unit not in units:
                    if number == 0:  # "없습니다"는 단위가 없어도 0이다
                        continue
                    reasons.append(f"{material['name']}: 이 품목에 쓰지 않는 단위 ({unit})")
                    ok = False
                else:
                    total += number * units[unit]
            if not ok:
                continue
            if total != int(total):
                reasons.append(f"{material['name']}: 낱개 수량이 정수가 아님 ({total})")
                continue
            records.append({"kind": "stock_report", "materialId": target, "qty": int(total)})

        elif kind == "schedule":
            if target not in projects:
                reasons.append(f"프로젝트 목록에 없음 ({target})")
                continue
            record = {"kind": "schedule_change", "project": target}
            try:
                start = resolve_date(entry.get("date") or {}, today, starts.get(target))
            except ValueError as error:
                reasons.append(f"{target}: {error}")
                continue
            if start:
                record["startDate"] = start
            quantity = entry.get("quantity")
            if quantity is not None:
                number = _number(quantity)
                if number is None or number <= 0 or number != int(number):
                    reasons.append(f"{target}: 생산수량이 올바르지 않음 ({quantity})")
                    continue
                record["productionQty"] = int(number)
            if len(record) == 2:
                reasons.append(f"{target}: 바뀐 날짜나 수량을 찾지 못함")
                continue
            records.append(record)
        else:
            reasons.append(f"모르는 종류 ({kind})")

    if strict:
        unused = sorted(digits - used)
        if unused and records:
            reasons.append(f"글에 있는 수가 정리 결과에 없음 ({', '.join(f'{n:g}' for n in unused)})")
    return {"records": records, "needsReview": bool(reasons), "reasons": reasons}


def check_direct_records(answer: dict, items: dict, scenario: dict) -> dict:
    """LLM이 레코드를 직접 만든 경우(지시만 준 방식)의 최소 검사: 형식이 맞고 반영할 수 있는지만 본다"""
    from .apply import RecordError, apply_records

    records = answer.get("records") if isinstance(answer, dict) else None
    reasons: list[str] = []
    if not isinstance(records, list) or not all(isinstance(r, dict) for r in records):
        return {"records": [], "needsReview": True, "reasons": ["형식이 맞지 않음"]}
    if answer.get("needsReview"):
        reasons.append(f"LLM이 확인 필요라고 함: {answer.get('reason', '')}")
    if not records and not reasons:
        reasons.append("뽑은 내용이 없음")
    try:
        apply_records(scenario, records)
    except (RecordError, TypeError, AttributeError) as error:
        reasons.append(f"반영할 수 없는 레코드: {error}")
    return {"records": records, "needsReview": bool(reasons), "reasons": reasons}
