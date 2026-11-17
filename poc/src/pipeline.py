"""음성(또는 글) → 받아 적기 → 정리 → "확인 필요" 판단 → 반영 → 발주 초안. 처음부터 끝까지 한 번에.

    입력   녹음 파일 하나 또는 글 한 줄
    AI     Whisper(STT) → LLM 정리(Ollama) 또는 규칙 기반 정리
    결과   정리된 표, "확인 필요" 여부와 이유, 반영 전후로 달라진 발주

"확인 필요"가 붙은 발화는 반영하지 않는다. 사람이 고쳐서 넣어야 한다.
"""

from __future__ import annotations

from pathlib import Path

from . import extract_llm, extract_rules
from .apply import apply_records, diff_plans
from .order_plan import calculate_plan

STATUS = {"overdue": "발주 시기 지남", "imminent": "발주 임박", "scheduled": "예정"}


def run_text(text: str, items: dict, scenario: dict, method: str = "hybrid", model: str | None = None) -> dict:
    """글 한 줄을 정리해서 발주 초안까지 만든다"""
    if method == "rules":
        prediction = extract_rules.extract(text, items, scenario)
    else:
        if not model:
            raise ValueError("LLM 방식은 model이 필요합니다")
        prediction = extract_llm.extract(text, items, scenario, model, method)

    before = calculate_plan(scenario)
    result = {
        "text": text,
        "method": method if method == "rules" else f"{method}@{model}",
        "records": prediction["records"],
        "needsReview": prediction["needsReview"],
        "reasons": prediction["reasons"],
        "applied": False,
        "ordersBefore": before["orders"],
        "ordersAfter": before["orders"],
        "changes": [],
    }
    if not prediction["needsReview"]:
        after = calculate_plan(apply_records(scenario, prediction["records"]))
        result.update(applied=True, ordersAfter=after["orders"], changes=diff_plans(before, after))
    return result


def run_audio(path: Path | str, items: dict, scenario: dict, stt_model, method: str = "hybrid",
              model: str | None = None, hint: str | None = None) -> dict:
    """녹음 파일 하나를 받아 적고 발주 초안까지 만든다. stt_model은 stt.load_model()로 만든 것"""
    from .stt import transcribe

    text, seconds = transcribe(stt_model, path, hint)
    return {"audio": str(path), "sttSeconds": round(seconds, 2), **run_text(text, items, scenario, method, model)}


def format_report(result: dict, items: dict) -> str:
    """사람이 읽는 결과"""
    names = {m["id"]: m["name"] for m in items["materials"]}
    lines = []
    if "audio" in result:
        lines.append(f"녹음: {result['audio']}  (받아 적기 {result['sttSeconds']}초)")
    lines.append(f"받아 적은 글: {result['text'] or '(비어 있음)'}")
    lines.append(f"정리 방식: {result['method']}")
    lines.append("")
    lines.append("정리 결과")
    if not result["records"]:
        lines.append("  (없음)")
    for r in result["records"]:
        if r["kind"] == "stock_report":
            lines.append(f"  재고 보고   {names.get(r['materialId'], r['materialId'])}({r['materialId']})  현재 재고 {r['qty']:,}")
        else:
            parts = [f"생산시작일 {r['startDate']}"] if "startDate" in r else []
            parts += [f"생산수량 {r['productionQty']:,}"] if "productionQty" in r else []
            lines.append(f"  일정 변경   {r['project']}  {', '.join(parts)}")
    lines.append("")
    if result["needsReview"]:
        lines.append("★ 확인 필요 — 반영하지 않았습니다. 사람이 확인해서 직접 넣어야 합니다.")
        lines += [f"  - {reason}" for reason in result["reasons"]]
        return "\n".join(lines)

    lines.append("반영했습니다. 달라진 발주:")
    if not result["changes"]:
        lines.append("  (발주는 달라지지 않았습니다)")
    labels = {"new": "새로 생김", "removed": "없어짐", "changed": "바뀜"}

    def show(orders):
        return ", ".join(f"{d} {q:,}" for d, q in orders) or "없음"

    for c in result["changes"]:
        lines.append(f"  {names.get(c['materialId'], c['materialId'])}({c['materialId']})  [{labels[c['change']]}]  "
                     f"{show(c['before'])}  →  {show(c['after'])}")
    lines.append("")
    lines.append("발주 초안 (발주일, 발주수량, 상태)")
    for o in sorted(result["ordersAfter"], key=lambda o: o["orderDate"]):
        lines.append(f"  {o['orderDate']}  {names.get(o['materialId'], o['materialId'])}({o['materialId']})  "
                     f"{o['orderQty']:,}  {STATUS.get(o['status'], o['status'])}")
    return "\n".join(lines)
