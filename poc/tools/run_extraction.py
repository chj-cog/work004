"""글 → 표 정리를 돌리고 결과를 data/predictions/ 에 저장한다.

    poc 폴더에서:
    .venv/Scripts/python tools/run_extraction.py --method rules --source script
    .venv/Scripts/python tools/run_extraction.py --method structured --model llama3.1:8b --source whisper-small --split dev

    --method   rules(규칙) | plain(LLM, 지시만) | structured(LLM + 품목 목록 + 정해진 출력 형식) | hybrid(structured + 숫자 미리 바꾸기 + 숫자 확인)
               hybrid2(hybrid + 더 엄격한 검사. 테스트를 본 뒤에 더한 추가 시도)
               cascade(규칙이 확정하면 규칙, 규칙이 "확인 필요"면 hybrid2. 추가 시도)
    --source   script(대본 글) 또는 data/transcripts/ 의 파일 이름(확장자 빼고)
    --split    dev(개발용 20개만) | all(61개 전부). 지시문을 다듬는 동안에는 dev만 쓴다
    --replay   LLM을 부르지 않고, 저장해 둔 응답으로 다시 계산한다 (Ollama 없이 재현)

LLM 방식은 Ollama가 켜져 있어야 한다.
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))

from src import extract_llm, extract_rules  # noqa: E402
from src.evaluate import judge, summarize  # noqa: E402

LABELS = {"dev": "개발용", "test_in": "테스트(범위 안)", "test_out": "테스트(범위 밖)"}


def load_texts(source: str, utterances: list[dict]) -> dict[str, str]:
    if source == "script":
        return {u["id"]: u["text"] for u in utterances}
    path = ROOT / "data" / "transcripts" / f"{source}.json"
    return {t["id"]: t["text"] for t in json.loads(path.read_text(encoding="utf-8"))["transcripts"]}


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--method", required=True, choices=["rules", "plain", "structured", "hybrid", "hybrid2", "cascade"])
    parser.add_argument("--model", help="Ollama 모델 이름 (LLM 방식일 때)")
    parser.add_argument("--source", default="script")
    parser.add_argument("--split", default="all", choices=["dev", "all"])
    parser.add_argument("--replay", action="store_true")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()
    if args.method != "rules" and not args.model:
        parser.error("LLM 방식은 --model 이 필요합니다")

    data = ROOT / "data"
    scenario = json.loads((data / "scenario" / "base.json").read_text(encoding="utf-8"))
    items = json.loads((data / "items.json").read_text(encoding="utf-8"))
    utterances = json.loads((data / "utterances.json").read_text(encoding="utf-8"))["utterances"]
    if args.split == "dev":
        utterances = [u for u in utterances if u["split"] == "dev"]
    texts = load_texts(args.source, utterances)

    method = args.method if args.method == "rules" else f"{args.method}@{args.model.replace(':', '-')}"
    out_dir = data / "predictions"
    out_dir.mkdir(exist_ok=True)
    out_path = out_dir / f"{method}__{args.source}{'__dev' if args.split == 'dev' else ''}.json"
    saved = {}
    llm_variant = "hybrid2" if args.method == "cascade" else args.method
    if args.replay:
        # hybrid2와 cascade는 hybrid와 LLM 호출이 같으므로 hybrid의 응답을 다시 쓴다
        base = "hybrid" if args.method in ("hybrid2", "cascade") else args.method
        replay_path = out_dir / out_path.name.replace(f"{args.method}@", f"{base}@", 1)
        saved = {r["id"]: r for r in json.loads(replay_path.read_text(encoding="utf-8"))["results"]}

    extras: dict[str, dict] = {}

    def predict_for(utterance: dict) -> dict:
        text = texts[utterance["id"]]
        by_rules = extract_rules.extract(text, items, scenario) if args.method in ("rules", "cascade") else None
        if by_rules is not None and (args.method == "rules" or not by_rules["needsReview"]):
            prediction = by_rules
        elif args.replay:
            old = saved[utterance["id"]]
            prediction = {**extract_llm.interpret(old["raw"], text, items, scenario, llm_variant),
                          "raw": old["raw"], "seconds": old["seconds"]}
        else:
            prediction = extract_llm.extract(text, items, scenario, args.model, llm_variant)
        extras[utterance["id"]] = {"input": text, "raw": prediction.get("raw"), "seconds": prediction.get("seconds")}
        return prediction

    results = [judge(u, predict_for(u), scenario) for u in utterances]
    summary = summarize(results)
    for r in results:
        r.update(extras[r["id"]])

    print(f"== {method} / 입력: {args.source} ==")
    for split, s in summary.items():
        print(f"{LABELS[split]}: 정리 정확도 {s['correct']}/{s['n']} ({s['accuracy']:.0%}) | 발주 판단 일치 {s['ordersMatch']}/{s['n']}"
              f" | 모르고 지나간 오류 {s['silentErrors']}건 | 확인 필요 {s['flagged']}건")
    if not args.quiet:
        for r in results:
            if not r["correct"]:
                kind = "확인 필요로 넘김" if r["flagged"] else "★모르고 지나감"
                print(f"- {r['id']} [{r['condition']}] 대본: {r['text']}\n    입력: {r['input']}\n    {kind}. 예측 {r['predicted']} / {r['reasons']}")

    out_path.write_text(json.dumps(
        {"method": method, "source": args.source, "split": args.split, "summary": summary, "results": results},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"저장: {out_path}")


if __name__ == "__main__":
    main()
