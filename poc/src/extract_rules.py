"""규칙 기반 정리 (기준선). 받아 적은 글 → 레코드.

LLM 없이 정규식과 품목 사전만으로 한다. LLM 정리가 이것보다 나은지 비교하는 기준이다.

방법
    1. 글에서 부자재 호칭과 프로젝트 호칭을 찾는다.
    2. 호칭 하나부터 다음 호칭 앞까지를 그 품목(프로젝트)에 대한 말로 본다.
    3. 그 안에서 "숫자 + 단위"(재고), 날짜·수량(일정)을 찾는다.
    4. 확정할 수 없으면 "확인 필요"를 붙이고 이유를 적는다.

결과
    {"records": [...], "needsReview": bool, "reasons": ["..."]}
    needsReview가 True면 records는 참고용이고, 사람이 확인하기 전에는 반영하지 않는다.
"""

from __future__ import annotations

import re
from datetime import date, timedelta

from .korean_numbers import NUMBER_PATTERN, parse_number

_HANGUL = "가-힣"
_WEEKDAYS = "월화수목금토일"


def _num(name: str = "num") -> str:
    """숫자 덩어리. 낱말의 처음에서만 시작한다 ("시작일이"의 "일이"를 숫자로 읽지 않도록)"""
    return rf"(?<![{_HANGUL}\d.,])(?P<{name}>{NUMBER_PATTERN})"


_HALF = rf"(?P<half>\s*반(?![{_HANGUL}]))?"
_ORDER_REQUEST = re.compile(r"발주|주문")
# STT가 "발주해 주세요"를 "말조해 주세요"로 적은 사례(개발용 D07)가 있어, 부탁하는 말투도 본다
_REQUEST = re.compile(r"주세요|주십시오|해\s*줘|부탁")
_HEDGE = re.compile(r"정도|쯤|같아|같은데|아마|대략|얼추|모르겠")
_ZERO = re.compile(r"없|떨어졌|떨어져|바닥")
_UNCHANGED = re.compile(r"\s*(?:그대로|동일|변동\s*없)")
_LATER = r"미뤄|미루|밀렸|밀려|늦춰|늦어|연기"
_EARLIER = r"당겨|당기|앞당"
_CORRECTION = re.compile(r"아니(?:요|야|다)?[,\s]")


def _alias_pattern(alias: str) -> str:
    """STT는 띄어쓰기를 제멋대로 한다. "큰박스", "포장 박스", "나 사"도 찾도록 글자 사이의 빈칸을 허용한다"""
    return r"\s*".join(re.escape(ch) for ch in alias if not ch.isspace())


def _find_mentions(text: str, items: dict) -> list[dict]:
    candidates = []
    for m in items["materials"]:
        for alias in m["aliases"]:
            candidates.append((alias, "material", m))
    for p in items["projects"]:
        for alias in p["aliases"]:
            candidates.append((alias, "project", p))
    candidates.sort(key=lambda c: -len(c[0]))  # "라벨지"를 "라벨"보다 먼저

    mentions, taken = [], [False] * len(text)
    for alias, kind, item in candidates:
        for found in re.finditer(_alias_pattern(alias), text, flags=re.IGNORECASE):
            if any(taken[found.start():found.end()]):
                continue
            for i in range(found.start(), found.end()):
                taken[i] = True
            mentions.append({"kind": kind, "item": item, "start": found.start(), "end": found.end()})
    return sorted(mentions, key=lambda m: m["start"])


def _after_correction(text: str, start: int, end: int) -> int:
    """"다섯 박스, 아니 네 박스" → 고쳐 말한 뒤쪽이 시작하는 위치"""
    found = list(_CORRECTION.finditer(text, start, end))
    return found[-1].end() if found else start


def _stock_record(material: dict, text: str, start: int, end: int, reasons: list[str]) -> dict | None:
    name = material["name"]
    units = {u: 1 for u in material["baseUnits"]}
    units.update({p["unit"]: p["qty"] for p in material["packs"]})
    unit_pattern = "|".join(re.escape(u) for u in sorted(units, key=len, reverse=True))
    # 글 전체에서 위치로 찾는다. 잘라낸 조각에서 찾으면 "라벨이 두 롤"의 조사 "이"가 낱말의 처음처럼 보인다
    quantity = re.compile(rf"{_num()}\s*(?P<unit>{unit_pattern}){_HALF}")

    total, found = 0.0, False
    for m in quantity.finditer(text, _after_correction(text, start, end), end):
        unit = m["unit"]
        number = parse_number(m["num"])
        if number is None:
            reasons.append(f"{name}: 수량을 숫자로 읽지 못함 ({m['num']} {unit})")
            return None
        # "반"은 "두 박스 반"처럼 단위 바로 뒤에 온다
        half = 0.5 if m["half"] else 0
        if half and units[unit] == 1:
            reasons.append(f"{name}: 낱개에 '반'이 붙음")
            return None
        total += (number + half) * units[unit]
        found = True

    if not found:
        if _ZERO.search(text, start, end):
            return {"kind": "stock_report", "materialId": material["id"], "qty": 0}
        reasons.append(f"{name}: 수량이나 단위를 찾지 못함")
        return None
    if total != int(total):
        reasons.append(f"{name}: 낱개 수량이 정수가 아님 ({total})")
        return None
    return {"kind": "stock_report", "materialId": material["id"], "qty": int(total)}


def _find_date(text: str, start: int, end: int, today: date, current_start: date | None, reasons: list[str], name: str) -> str | None:
    # 1) "일주일 미뤄졌어요": 지금 시작일에서 계산한다. "이십사 일로 밀렸어요"는 '로'가 있어 여기 걸리지 않는다
    shift = re.compile(rf"{_num()}\s*(?P<unit>주일|주|일)\s*(?:씩\s*|정도\s*|더\s*)?(?P<dir>{_LATER}|{_EARLIER})").search(text, start, end)
    if shift:
        number = parse_number(shift["num"])
        if number is None or current_start is None:
            reasons.append(f"{name}: 며칠을 옮기는지 계산하지 못함")
            return None
        days = int(number) * (1 if shift["unit"] == "일" else 7)
        if re.match(_EARLIER, shift["dir"]):
            days = -days
        return (current_start + timedelta(days=days)).isoformat()

    # 2) "다음 주 화요일": 고쳐 말했으면 마지막 요일
    week = re.compile(r"(이번|다음|다다음)\s*주").search(text, start, end)
    weekdays = re.compile(rf"([{_WEEKDAYS}])요일").findall(text, start, end)
    if week and weekdays:
        monday = today - timedelta(days=today.weekday())
        offset = {"이번": 0, "다음": 7, "다다음": 14}[week[1]]
        return (monday + timedelta(days=offset + _WEEKDAYS.index(weekdays[-1]))).isoformat()
    if weekdays:
        reasons.append(f"{name}: 어느 주의 {weekdays[-1]}요일인지 알 수 없음")
        return None

    # 3) "십이월 이 일", "이십사 일": 고쳐 말했으면 마지막 날짜
    found = list(re.compile(rf"(?:{_num('month')}\s*월\s*)?{_num('day')}\s*일(?![{_HANGUL}]*주)").finditer(text, start, end))
    if not found:
        return None
    m = found[-1]
    day = parse_number(m["day"])
    month = parse_number(m["month"]) if m["month"] else None
    if day is None or (m["month"] and month is None):
        reasons.append(f"{name}: 날짜를 읽지 못함")
        return None
    try:
        if month is not None:
            result = date(today.year, int(month), int(day))
            if result < today:
                result = date(today.year + 1, int(month), int(day))
        else:  # 날만 말하면 오늘 이후 가장 가까운 그 날
            result = date(today.year, today.month, int(day))
            if result < today:
                year, next_month = (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
                result = date(year, next_month, int(day))
    except (ValueError, TypeError):
        reasons.append(f"{name}: 없는 날짜 ({m[0]})")
        return None
    return result.isoformat()


def _schedule_record(project: dict, text: str, start: int, end: int, today: date, current_start: date | None, reasons: list[str]) -> dict | None:
    name = project["id"]
    before = len(reasons)
    record: dict = {"kind": "schedule_change", "project": project["id"]}

    new_start = _find_date(text, start, end, today, current_start, reasons, name)
    if new_start:
        record["startDate"] = new_start

    quantity = re.compile(rf"{_num()}\s*(?:개|대|세트|ea)", flags=re.IGNORECASE)
    for m in quantity.finditer(text, _after_correction(text, start, end), end):
        if _UNCHANGED.match(text, m.end(), end):
            continue  # "수량 백 개 그대로"
        number = parse_number(m["num"])
        if number is None or number <= 0 or number != int(number):
            reasons.append(f"{name}: 수량을 숫자로 읽지 못함 ({m['num']})")
            return None
        record["productionQty"] = int(number)

    # "수량은 80K입니다"처럼 수량을 말했는데 읽지 못하면, 날짜만 반영하고 넘어가지 않는다 (개발용 D12)
    told_quantity = re.compile(r"수량").search(text, start, end)
    if told_quantity and "productionQty" not in record and not re.compile(r"그대로|동일").search(text, start, end):
        reasons.append(f"{name}: 수량을 말했지만 읽지 못함")
    if len(reasons) > before:
        return None
    if len(record) == 2:
        reasons.append(f"{name}: 바뀐 날짜나 수량을 찾지 못함")
        return None
    return record


def extract(text: str, items: dict, scenario: dict) -> dict:
    """글 하나를 레코드로 정리한다. scenario는 오늘 날짜와 지금 생산일정을 알기 위해 쓴다"""
    today = date.fromisoformat(scenario["today"])
    starts = {p["id"]: date.fromisoformat(p["startDate"]) for p in scenario["projects"]}
    reasons: list[str] = []
    records: list[dict] = []

    if _ORDER_REQUEST.search(text):
        reasons.append("발주 요청으로 보임 (재고·일정 보고가 아님)")
    elif _REQUEST.search(text):
        reasons.append("보고가 아니라 부탁하는 말로 보임")
    if not text.strip():
        return {"records": [], "needsReview": True, "reasons": ["받아 적은 글이 비어 있음"]}
    if _HEDGE.search(text):
        reasons.append("어림잡아 말함")

    mentions = _find_mentions(text, items)
    if not mentions:
        reasons.append("부자재 목록이나 프로젝트 목록에 있는 이름을 찾지 못함")

    lead = text[: mentions[0]["start"]] if mentions else ""
    if any(parse_number(m["num"]) is not None for m in re.finditer(rf"{_num()}\s*[{_HANGUL}]", lead)):
        reasons.append("어느 품목의 수량인지 알 수 없는 숫자가 있음")

    seen: set[tuple[str, str]] = set()
    for i, mention in enumerate(mentions):
        end = mentions[i + 1]["start"] if i + 1 < len(mentions) else len(text)
        item = mention["item"]
        key = (mention["kind"], item["id"])
        if key in seen:
            reasons.append(f"{item.get('name', item['id'])}: 한 발화에서 두 번 말함")
            continue
        seen.add(key)
        if mention["kind"] == "material":
            record = _stock_record(item, text, mention["end"], end, reasons)
        else:
            record = _schedule_record(item, text, mention["end"], end, today, starts.get(item["id"]), reasons)
        if record:
            records.append(record)

    return {"records": records, "needsReview": bool(reasons), "reasons": reasons}
