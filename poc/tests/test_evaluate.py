"""지표 계산 테스트."""

import json
from pathlib import Path

from src.evaluate import evaluate, judge, normalize, summarize
from src.extract_rules import extract

DATA = Path(__file__).parents[1] / "data"
BASE = json.loads((DATA / "scenario" / "base.json").read_text(encoding="utf-8"))
ITEMS = json.loads((DATA / "items.json").read_text(encoding="utf-8"))
UTTERANCES = json.loads((DATA / "utterances.json").read_text(encoding="utf-8"))["utterances"]

STOCK = {"id": "U1", "split": "test_in", "condition": "재고", "text": "라벨 두 롤",
         "records": [{"kind": "stock_report", "materialId": "C", "qty": 2000}]}
REVIEW = {"id": "U2", "split": "test_out", "condition": "애매", "text": "나사 이삼 박스",
          "records": [], "needsReview": True, "note": "범위"}


def pred(records, review=False):
    return {"records": records, "needsReview": review, "reasons": []}


def test_normalize_ignores_order_and_number_type():
    a = [{"kind": "stock_report", "materialId": "A", "qty": 800},
         {"kind": "schedule_change", "project": "P1", "startDate": "2026-11-24"}]
    b = [{"project": "P1", "startDate": "2026-11-24", "kind": "schedule_change"},
         {"qty": 800.0, "materialId": "A", "kind": "stock_report"}]
    assert normalize(a) == normalize(b)


def test_correct_answer():
    r = judge(STOCK, pred(STOCK["records"]), BASE)
    assert r["correct"] and r["ordersMatch"] and not r["silentError"]


def test_wrong_and_unflagged_is_a_silent_error():
    r = judge(STOCK, pred([{"kind": "stock_report", "materialId": "C", "qty": 2}]), BASE)
    assert not r["correct"] and r["silentError"]


def test_wrong_but_flagged_is_not_silent():
    r = judge(STOCK, pred([], review=True), BASE)
    assert not r["correct"] and not r["silentError"]


def test_right_records_but_flagged_counts_as_not_correct():
    """맞게 뽑았어도 "확인 필요"를 붙이면 사람 손이 가므로 정확도에는 넣지 않는다"""
    r = judge(STOCK, pred(STOCK["records"], review=True), BASE)
    assert not r["correct"] and not r["silentError"]


def test_missing_everything_is_a_silent_error():
    r = judge(STOCK, pred([]), BASE)
    assert not r["correct"] and r["silentError"] and not r["ordersMatch"]


def test_review_utterance():
    assert judge(REVIEW, pred([], review=True), BASE)["correct"]
    r = judge(REVIEW, pred([{"kind": "stock_report", "materialId": "A", "qty": 1600}]), BASE)
    assert not r["correct"] and r["silentError"]


def test_unapplicable_prediction_does_not_crash():
    r = judge(STOCK, pred([{"kind": "stock_report", "materialId": "Z", "qty": 1}]), BASE)
    assert not r["correct"] and not r["ordersMatch"]


def test_summarize():
    results = [judge(STOCK, pred(STOCK["records"]), BASE), judge(STOCK, pred([]), BASE),
               judge(REVIEW, pred([], review=True), BASE)]
    s = summarize(results)
    assert s["test_in"] == {"n": 2, "correct": 1, "accuracy": 0.5, "ordersMatch": 1, "ordersMatchRate": 0.5,
                            "silentErrors": 1, "flagged": 0}
    assert s["test_out"]["accuracy"] == 1.0 and s["test_out"]["flagged"] == 1


def test_rules_never_pass_a_wrong_answer_silently_on_the_script():
    """규칙 기반 정리의 대본 글 결과가 나빠지면 알 수 있게 고정해 둔다"""
    _, summary = evaluate(UTTERANCES, lambda text: extract(text, ITEMS, BASE), BASE)
    assert all(s["silentErrors"] == 0 for s in summary.values())
    assert summary["dev"]["accuracy"] == 1.0
