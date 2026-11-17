"""LLM 정리. 받아 적은 글 → 레코드. PC에서 도는 Ollama를 API처럼 호출한다 (http://localhost:11434).

세 가지 방식을 비교한다 (문제 정의서 §7.2).

    plain        ② 지시만: 품목 목록을 글로 주고, 레코드(낱개 수량, 날짜)를 LLM이 직접 만들게 한다
    structured   ③ 품목 목록 + 정해진 출력 형식: LLM은 품목·숫자·단위·날짜 표현을 **뽑기만** 하고,
                 곱셈과 날짜 계산, "확인 필요" 판단은 코드(review.py)가 한다
    hybrid       ③에 두 가지를 더한 것. 개발용 발화에서 LLM이 "천이백"을 1300으로 읽는 오류를 보고 추가했다:
                 한글 숫자를 미리 아라비아 숫자로 바꿔서 주고, LLM이 적은 수가 글에 있는 수인지 확인한다
    hybrid2      hybrid와 LLM 호출은 같고, 검사만 더 엄격하다. **테스트 결과를 본 뒤에** 더한 것이라
                 그 수치는 공정한 측정이 아니다 (추가 시도로만 기록한다)

지시문과 예시는 개발용 발화 20개만 보고 다듬는다. 예시 문장은 대본에 없는 문장으로 따로 지었다.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

from .korean_numbers import normalize_numbers
from .review import check_direct_records, to_records

OLLAMA_URL = "http://localhost:11434/api/chat"
VARIANTS = ("plain", "structured", "hybrid", "hybrid2")


def _item_lines(items: dict) -> str:
    lines = []
    for m in items["materials"]:
        packs = ", ".join(f"1{p['unit']} = {p['qty']}{m['baseUnits'][0]}" for p in m["packs"])
        lines.append(f"- {m['id']}: {m['name']} (다르게 부르는 이름: {', '.join(m['aliases'][1:]) or '없음'}) "
                     f"/ 낱개 단위: {', '.join(m['baseUnits'])} / 포장: {packs}")
    return "\n".join(lines)


def _project_lines(items: dict, scenario: dict) -> str:
    current = {p["id"]: p for p in scenario["projects"]}
    return "\n".join(
        f"- {p['id']} (부르는 이름: {', '.join(p['aliases'])}) / 지금 생산시작일 {current[p['id']]['startDate']}, "
        f"생산수량 {current[p['id']]['productionQty']}"
        for p in items["projects"])


def _weekday(iso: str) -> str:
    from datetime import date
    return "월화수목금토일"[date.fromisoformat(iso).weekday()]


# ── ② 지시만 ────────────────────────────────────────────────────────────────

def plain_prompt(items: dict, scenario: dict) -> str:
    today = scenario["today"]
    return f"""당신은 제조 현장의 부자재 담당자가 전화나 말로 들은 내용을 표로 정리하는 일을 돕습니다.
오늘은 {today} ({_weekday(today)}요일)입니다.

부자재 목록:
{_item_lines(items)}

프로젝트 목록:
{_project_lines(items, scenario)}

들은 말에서 재고 보고와 생산 일정 변경을 찾아 JSON으로만 답하세요.
- 재고 보고: {{"kind": "stock_report", "materialId": "부자재 코드", "qty": 낱개 수량}}
- 일정 변경: {{"kind": "schedule_change", "project": "프로젝트 코드", "startDate": "YYYY-MM-DD", "productionQty": 숫자}} (바뀐 것만 넣기)
- 확실하지 않거나, 목록에 없는 품목이거나, 재고·일정 보고가 아니면 records를 비우고 needsReview를 true로 하세요.

답 형식: {{"records": [...], "needsReview": false, "reason": ""}}"""


# ── ③ 품목 목록 + 정해진 출력 형식 ──────────────────────────────────────────

def structured_schema(items: dict) -> dict:
    targets = [m["id"] for m in items["materials"]] + [p["id"] for p in items["projects"]] + ["unknown"]
    return {
        "type": "object",
        "properties": {
            "entries": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "evidence": {"type": "string"},
                        "type": {"type": "string", "enum": ["stock", "schedule", "order_request", "unclear"]},
                        "target": {"type": "string", "enum": targets},
                        "amounts": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {"number": {"type": "number"}, "unit": {"type": "string"}},
                                "required": ["number", "unit"],
                            },
                        },
                        "date": {
                            "type": "object",
                            "properties": {
                                "form": {"type": "string", "enum": ["none", "month_day", "day", "weekday", "shift"]},
                                "month": {"type": ["integer", "null"]},
                                "day": {"type": ["integer", "null"]},
                                "week": {"type": "string", "enum": ["none", "this", "next"]},
                                "weekday": {"type": "string", "enum": ["none", "월", "화", "수", "목", "금", "토", "일"]},
                                "shift_days": {"type": ["integer", "null"]},
                            },
                            "required": ["form", "month", "day", "week", "weekday", "shift_days"],
                        },
                        "quantity": {"type": ["number", "null"]},
                    },
                    "required": ["evidence", "type", "target", "amounts", "date", "quantity"],
                },
            }
        },
        "required": ["entries"],
    }


_NO_DATE = {"form": "none", "month": None, "day": None, "week": "none", "weekday": "none", "shift_days": None}


def _example(text: str, entries: list[dict]) -> str:
    return f"들은 말: {text}\n답: {json.dumps({'entries': entries}, ensure_ascii=False)}"


def structured_prompt(items: dict, scenario: dict) -> str:
    def stock(evidence, target, *amounts):
        return {"evidence": evidence, "type": "stock", "target": target,
                "amounts": [{"number": n, "unit": u} for n, u in amounts], "date": _NO_DATE, "quantity": None}

    def schedule(evidence, target, date=None, quantity=None):
        return {"evidence": evidence, "type": "schedule", "target": target, "amounts": [],
                "date": {**_NO_DATE, **(date or {})}, "quantity": quantity}

    def other(evidence, kind):
        return {"evidence": evidence, "type": kind, "target": "unknown", "amounts": [], "date": _NO_DATE, "quantity": None}

    examples = [
        _example("라벨지 일곱 롤 반 있어요.", [stock("라벨지 일곱 롤 반", "C", (7.5, "롤"))]),
        _example("카톤 아홉 묶음하고 낱개 열다섯 장, 그리고 에어캡은 없어요.",
                 [stock("카톤 아홉 묶음하고 낱개 열다섯 장", "B", (9, "묶음"), (15, "장")),
                  stock("에어캡은 없어요", "D", (0, "개"))]),
        _example("스크류 여덟, 아니 일곱 박스요.", [stock("스크류 여덟, 아니 일곱 박스", "A", (7, "박스"))]),
        _example("피원은 십이월 구 일로 밀렸고 수량은 구십 개예요.",
                 [schedule("피원은 십이월 구 일로 밀렸고 수량은 구십 개", "P1", {"form": "month_day", "month": 12, "day": 9}, 90)]),
        _example("피투 건 이십육 일로 바뀌었어요.", [schedule("피투 건 이십육 일로", "P2", {"form": "day", "day": 26})]),
        _example("피원 건 다음 주 목요일로 당겨졌어요.",
                 [schedule("피원 건 다음 주 목요일로", "P1", {"form": "weekday", "week": "next", "weekday": "목"})]),
        _example("피투 건 삼 일 당겨졌어요.", [schedule("피투 건 삼 일 당겨졌어요", "P2", {"form": "shift", "shift_days": -3})]),
        _example("완충재 세 봉지 발주 넣어 주세요.", [other("완충재 세 봉지 발주 넣어 주세요", "order_request")]),
        _example("나사 네다섯 박스쯤 될 거예요.", [other("네다섯 박스쯤", "unclear")]),
        _example("고무줄 두 봉지 남았어요.", [other("고무줄", "unclear")]),
    ]
    today = scenario["today"]
    return f"""당신은 제조 현장의 부자재 담당자가 전화나 말로 들은 내용에서 필요한 값만 뽑아냅니다.
들은 말은 음성을 받아 적은 글이라 오타가 있을 수 있습니다. 오늘은 {today} ({_weekday(today)}요일)입니다.

부자재 목록:
{_item_lines(items)}

프로젝트 목록:
{_project_lines(items, scenario)}

규칙
1. 말한 것만 뽑습니다. 계산하지 않습니다. "두 롤"은 number 2, unit "롤"로 적고 2000으로 바꾸지 않습니다. "반"은 0.5를 더합니다.
2. type: 재고가 몇 남았다는 보고는 "stock", 생산 시작일·생산수량이 바뀌었다는 말은 "schedule", 발주·주문해 달라는 말은 "order_request".
3. target: 목록의 코드. 받아 적다 생긴 오타로 보이면 가장 가까운 것을 고르고, 목록에 없는 품목이면 "unknown"과 type "unclear".
4. 수량이 "두세 박스", "정도", "것 같아요"처럼 어림이거나, 단위가 없거나, 무엇을 가리키는지 알 수 없으면 type "unclear".
5. 고쳐 말하면("아니") 뒤에 말한 값만 적습니다. 재고가 없다는 말은 number 0, unit "개".
6. date: 날짜를 말하지 않았으면 form "none". "십이월 이 일"은 "month_day", "이십사 일"은 "day", "다음 주 화요일"은 "weekday"(week는 이번 주 "this", 다음 주 "next"), "일주일 미뤄졌다"는 "shift"(미뤄지면 양수, 당겨지면 음수, 일주일은 7).
7. quantity: 일정 변경에서 바뀐 생산수량. "그대로"라고 하면 null.
8. evidence: 근거가 된 부분을 들은 말에서 **글자 그대로** 옮겨 적습니다.

예시
""" + "\n\n".join(examples)


# ── 호출 ────────────────────────────────────────────────────────────────────

def call_ollama(model: str, system: str, user: str, fmt, timeout: float = 300) -> tuple[str, float]:
    """(응답 글, 걸린 시간 초). 같은 입력에 같은 답이 나오도록 temperature 0, seed 고정"""
    payload = {
        "model": model, "stream": False, "format": fmt, "think": False,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "options": {"temperature": 0, "seed": 0, "num_ctx": 8192},
    }
    started = time.perf_counter()
    for attempt in (1, 2):
        request = urllib.request.Request(OLLAMA_URL, data=json.dumps(payload).encode("utf-8"),
                                         headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = json.loads(response.read().decode("utf-8"))
            return body["message"]["content"], time.perf_counter() - started
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            if attempt == 1 and "think" in detail:  # 생각 기능이 없는 모델
                payload.pop("think")
                continue
            raise RuntimeError(f"Ollama 오류 {error.code}: {detail}") from None
        except urllib.error.URLError as error:
            raise RuntimeError(f"Ollama에 연결하지 못했습니다. Ollama가 켜져 있는지 확인하세요 ({error.reason})") from None
    raise AssertionError("unreachable")


def extract(text: str, items: dict, scenario: dict, model: str, variant: str = "structured") -> dict:
    """글 하나를 정리한다. 결과에 원래 응답(raw)과 걸린 시간(seconds)도 넣는다"""
    if not text.strip():
        return {"records": [], "needsReview": True, "reasons": ["받아 적은 글이 비어 있음"], "raw": "", "seconds": 0.0}
    if variant == "plain":
        system, fmt = plain_prompt(items, scenario), "json"
    elif variant in ("structured", "hybrid", "hybrid2"):
        system, fmt = structured_prompt(items, scenario), structured_schema(items)
    else:
        raise ValueError(f"모르는 방식: {variant}")
    shown = normalize_numbers(text) if variant in ("hybrid", "hybrid2") else text
    raw, seconds = call_ollama(model, system, f"들은 말: {shown}\n답:", fmt)
    return {**interpret(raw, text, items, scenario, variant), "raw": raw, "seconds": round(seconds, 3)}


def interpret(raw: str, text: str, items: dict, scenario: dict, variant: str) -> dict:
    """저장해 둔 응답으로도 다시 계산할 수 있게, 응답 해석을 호출과 나눠 둔다"""
    if not text.strip():
        return {"records": [], "needsReview": True, "reasons": ["받아 적은 글이 비어 있음"]}
    try:
        answer = json.loads(raw)
    except json.JSONDecodeError:
        return {"records": [], "needsReview": True, "reasons": ["LLM 응답이 JSON이 아님"]}
    if variant == "plain":
        return check_direct_records(answer, items, scenario)
    if variant in ("hybrid", "hybrid2"):
        return to_records(answer, normalize_numbers(text), items, scenario, check_numbers=True, strict=variant == "hybrid2")
    return to_records(answer, text, items, scenario)
