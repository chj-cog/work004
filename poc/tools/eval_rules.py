"""규칙 기반 정리를 대본의 글(STT를 거치지 않은 글)로 평가한다.

    poc 폴더에서:  .venv/Scripts/python tools/eval_rules.py
결과는 화면에 나오고 outputs/rules_on_script.json 에 저장된다.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))

from src.evaluate import evaluate  # noqa: E402
from src.extract_rules import extract  # noqa: E402

LABELS = {"dev": "개발용", "test_in": "테스트(범위 안)", "test_out": "테스트(범위 밖)"}


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    data = ROOT / "data"
    scenario = json.loads((data / "scenario" / "base.json").read_text(encoding="utf-8"))
    items = json.loads((data / "items.json").read_text(encoding="utf-8"))
    utterances = json.loads((data / "utterances.json").read_text(encoding="utf-8"))["utterances"]

    results, summary = evaluate(utterances, lambda text: extract(text, items, scenario), scenario)

    for split, s in summary.items():
        print(f"{LABELS[split]}: 발화 {s['n']}개 | 정리 정확도(S2) {s['correct']}/{s['n']} ({s['accuracy']:.0%})"
              f" | 발주 판단 일치(S3) {s['ordersMatch']}/{s['n']} ({s['ordersMatchRate']:.0%})"
              f" | 모르고 지나간 오류(S4) {s['silentErrors']}건 | 확인 필요 {s['flagged']}건")

    wrong = [r for r in results if not r["correct"]]
    print(f"\n틀린 발화 {len(wrong)}건")
    for r in wrong:
        kind = "확인 필요로 넘김" if r["flagged"] else "모르고 지나감"
        print(f"- {r['id']} [{r['condition']}] {r['text']}")
        print(f"    {kind}. 예측 {r['predicted']} / 이유 {r['reasons']}")

    out = ROOT / "outputs"
    out.mkdir(exist_ok=True)
    (out / "rules_on_script.json").write_text(
        json.dumps({"summary": summary, "results": results}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n저장: {out / 'rules_on_script.json'}")


if __name__ == "__main__":
    main()
