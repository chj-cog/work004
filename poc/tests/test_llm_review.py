"""LLM 출력을 레코드로 바꾸는 부분과 "확인 필요" 판단 테스트. Ollama 없이 돈다 (LLM 응답을 직접 만들어 넣는다)."""

import json
from pathlib import Path

import pytest

from src.extract_llm import interpret, plain_prompt, structured_prompt, structured_schema
from src.korean_numbers import normalize_numbers, numbers_in
from src.review import to_records

DATA = Path(__file__).parents[1] / "data"
BASE = json.loads((DATA / "scenario" / "base.json").read_text(encoding="utf-8"))
ITEMS = json.loads((DATA / "items.json").read_text(encoding="utf-8"))
UTTERANCES = json.loads((DATA / "utterances.json").read_text(encoding="utf-8"))["utterances"]
NO_DATE = {"form": "none", "month": None, "day": None, "week": "none", "weekday": "none", "shift_days": None}


def stock(evidence, target, *amounts):
    return {"evidence": evidence, "type": "stock", "target": target,
            "amounts": [{"number": n, "unit": u} for n, u in amounts], "date": NO_DATE, "quantity": None}


def schedule(evidence, target, date=None, quantity=None):
    return {"evidence": evidence, "type": "schedule", "target": target, "amounts": [],
            "date": {**NO_DATE, **(date or {})}, "quantity": quantity}


def run(text, *entries, check_numbers=False):
    return to_records({"entries": list(entries)}, text, ITEMS, BASE, check_numbers=check_numbers)


def test_code_does_the_multiplication():
    result = run("스티커 다섯 롤 반 남았어요.", stock("스티커 다섯 롤 반", "C", (5.5, "롤")))
    assert result == {"records": [{"kind": "stock_report", "materialId": "C", "qty": 5500}], "needsReview": False, "reasons": []}


def test_pack_plus_loose_pieces_and_zero():
    assert run("포장박스 여섯 묶음하고 낱개 스무 장", stock("여섯 묶음하고 낱개 스무 장", "B", (6, "묶음"), (20, "장")))["records"][0]["qty"] == 320
    assert run("나사 재고 없습니다", stock("나사 재고 없습니다", "A", (0, "개")))["records"][0]["qty"] == 0


@pytest.mark.parametrize("date, expected", [
    ({"form": "day", "day": 24}, "2026-11-24"),
    ({"form": "day", "day": 2}, "2026-12-02"),
    ({"form": "month_day", "month": 12, "day": 1}, "2026-12-01"),
    ({"form": "month_day", "month": 1, "day": 5}, "2027-01-05"),
    ({"form": "weekday", "week": "this", "weekday": "금"}, "2026-11-06"),
    ({"form": "weekday", "week": "next", "weekday": "화"}, "2026-11-10"),
    ({"form": "shift", "shift_days": 7}, "2026-11-27"),
    ({"form": "shift", "shift_days": -3}, "2026-11-17"),
])
def test_code_does_the_date_arithmetic(date, expected):
    result = run("피원 건 바뀌었어요", schedule("피원 건", "P1", date))
    assert result["records"] == [{"kind": "schedule_change", "project": "P1", "startDate": expected}], result["reasons"]


@pytest.mark.parametrize("entry, reason", [
    (stock("테이프 열 롤", "unknown", (10, "롤")), "목록에 없는"),
    (stock("나사 세 롤", "A", (3, "롤")), "쓰지 않는 단위"),
    (stock("나사 세 박스", "A"), "수량을 찾지 못함"),
    (stock("라벨 열 롤 남았어요", "C", (10, "롤")), "근거로 든 말이 글에 없음"),      # 글에 없는 말을 근거로 듦
    (schedule("피원 건", "P1"), "바뀐 날짜나 수량"),
    (schedule("피원 건", "P1", {"form": "month_day", "month": 2, "day": 30}), "없는 날짜"),
    (schedule("피원 건", "P1", {"form": "weekday", "week": "none", "weekday": "금"}), "어느 주"),
    ({**stock("나사 세 박스", "A"), "type": "order_request"}, "발주 요청"),
    ({**stock("나사 세 박스", "A"), "type": "unclear"}, "불확실"),
])
def test_needs_review(entry, reason):
    result = run("나사 세 박스 테이프 열 롤 피원 건 나사 세 롤", entry)
    assert result["needsReview"] and any(reason in r for r in result["reasons"]), result


def test_empty_or_broken_output_needs_review():
    assert to_records({"entries": []}, "아무 말", ITEMS, BASE)["needsReview"]
    assert to_records("???", "아무 말", ITEMS, BASE)["needsReview"]
    assert interpret("JSON이 아님", "아무 말", ITEMS, BASE, "structured")["needsReview"]


def test_number_check_catches_a_misread_number():
    """LLM이 "천이백"을 1300으로 읽은 실제 사례 (개발용 D05)"""
    text = normalize_numbers("나사 지금 천이백 개 남았습니다.")
    wrong = run(text, stock("나사 지금 1200 개", "A", (1300, "개")), check_numbers=True)
    assert wrong["needsReview"] and "글에 없는 수" in wrong["reasons"][0]
    assert not run(text, stock("나사 지금 1200 개", "A", (1200, "개")), check_numbers=True)["needsReview"]
    # 확인을 끄면 그대로 통과한다 (그래서 모르고 지나가는 오류가 된다)
    assert not run(text, stock("나사 지금 1200 개", "A", (1300, "개")))["needsReview"]


def test_number_check_allows_half_and_weeks():
    assert not run("스티커 5 롤 반", stock("스티커 5 롤 반", "C", (5.5, "롤")), check_numbers=True)["needsReview"]
    assert not run("피원 건 1주일 미뤄졌어요", schedule("피원 건 1주일", "P1", {"form": "shift", "shift_days": 7}), check_numbers=True)["needsReview"]


def test_normalize_numbers():
    assert normalize_numbers("나사 지금 천이백 개 남았습니다.") == "나사 지금 1200 개 남았습니다."
    assert normalize_numbers("피투는 십이월 일 일 시작") == "피투는 12월 1 일 시작"
    assert normalize_numbers("라벨이 두 롤") == "라벨이 2 롤"                  # 조사 "이"는 그대로
    assert normalize_numbers("나사 이삼 박스 정도") == "나사 이삼 박스 정도"    # 어림수는 바꾸지 않는다
    assert numbers_in("나사 1,200개, 라벨 두 롤") == {1200.0, 2.0}


def test_plain_variant_only_checks_shape():
    ok = interpret('{"records": [{"kind": "stock_report", "materialId": "A", "qty": 800}], "needsReview": false}',
                   "나사 한 박스", ITEMS, BASE, "plain")
    assert not ok["needsReview"]
    bad = interpret('{"records": [{"kind": "stock_report", "materialId": "Z", "qty": 800}]}', "x", ITEMS, BASE, "plain")
    assert bad["needsReview"]


def test_prompts_do_not_leak_test_sentences():
    """지시문의 예시에 테스트 발화가 들어가면 시험 문제를 미리 알려 준 것이 된다"""
    prompts = structured_prompt(ITEMS, BASE) + plain_prompt(ITEMS, BASE)
    for u in UTTERANCES:
        assert u["text"] not in prompts, u["id"]
    assert set(structured_schema(ITEMS)["properties"]["entries"]["items"]["properties"]["target"]["enum"]) == {
        "A", "B", "C", "D", "P1", "P2", "unknown"}
