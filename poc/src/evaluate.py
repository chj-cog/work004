"""정리 결과를 정답과 비교해 지표를 계산한다 (문제 정의서 §6).

    S2 정리 정확도            발화 단위로 종류·품목·수량·날짜가 모두 정답과 같은 비율
    S3 발주 판단 일치율       정리 결과로 계산한 발주 초안이 정답 기준 발주 초안과 같은 비율
    S4 모르고 지나가는 오류   틀렸는데 "확인 필요"도 없었던 발화 수

판정
    정답이 "확인 필요"인 발화: 예측에도 "확인 필요"가 붙으면 맞음.
    그 밖의 발화: "확인 필요" 없이 레코드가 정답과 같아야 맞음.
        "확인 필요"가 붙었으면 틀린 것으로 세되(S2), 사람이 보게 되므로 S4에는 넣지 않는다.
"""

from __future__ import annotations

from .apply import RecordError, apply_records, order_signature
from .order_plan import calculate_plan


def normalize(records: list[dict]) -> list[tuple]:
    """레코드 순서와 키 순서에 상관없이 비교할 수 있게 바꾼다"""
    out = []
    for r in records:
        if r.get("kind") == "stock_report":
            out.append(("stock_report", r.get("materialId"), float(r.get("qty", -1)), None))
        else:
            qty = r.get("productionQty")
            out.append((r.get("kind"), r.get("project"), None if qty is None else float(qty), r.get("startDate")))
    return sorted(out, key=repr)


def _orders(scenario: dict, records: list[dict]) -> list[tuple] | None:
    try:
        return order_signature(calculate_plan(apply_records(scenario, records)))
    except RecordError:
        return None


def judge(utterance: dict, prediction: dict, scenario: dict) -> dict:
    """발화 하나의 판정"""
    flagged = bool(prediction.get("needsReview"))
    predicted = prediction.get("records", [])
    if utterance.get("needsReview"):
        correct, orders_match = flagged, flagged
    else:
        correct = not flagged and normalize(predicted) == normalize(utterance["records"])
        # "확인 필요"가 붙으면 반영되지 않으므로, 기준 상황 그대로의 발주 초안과 비교된다
        applied = [] if flagged else predicted
        orders_match = _orders(scenario, applied) == _orders(scenario, utterance["records"])
    return {
        "id": utterance["id"],
        "split": utterance["split"],
        "condition": utterance["condition"],
        "text": utterance["text"],
        "correct": correct,
        "flagged": flagged,
        "silentError": not correct and not flagged,
        "ordersMatch": orders_match,
        "expected": utterance["records"],
        "expectedReview": bool(utterance.get("needsReview")),
        "predicted": predicted,
        "reasons": prediction.get("reasons", []),
    }


def summarize(results: list[dict]) -> dict:
    """묶음(split)별 지표"""
    summary = {}
    for split in sorted({r["split"] for r in results}):
        rows = [r for r in results if r["split"] == split]
        n = len(rows)
        correct = sum(r["correct"] for r in rows)
        orders = sum(r["ordersMatch"] for r in rows)
        summary[split] = {
            "n": n,
            "correct": correct,
            "accuracy": correct / n,                                  # S2
            "ordersMatch": orders,
            "ordersMatchRate": orders / n,                            # S3
            "silentErrors": sum(r["silentError"] for r in rows),      # S4
            "flagged": sum(r["flagged"] for r in rows),
        }
    return summary


def evaluate(utterances: list[dict], predict, scenario: dict) -> tuple[list[dict], dict]:
    """predict(text) → {"records", "needsReview", "reasons"} 를 모든 발화에 돌린다"""
    results = [judge(u, predict(u["text"]), scenario) for u in utterances]
    return results, summarize(results)
