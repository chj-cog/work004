"""data/transcripts/ 의 STT 결과를 대본과 비교한다. 녹음이나 Whisper 없이 돌릴 수 있다.

    poc 폴더에서:  .venv/Scripts/python tools/eval_stt.py
    발화별로 놓친 핵심어까지 보려면:  .venv/Scripts/python tools/eval_stt.py whisper-small
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))

from src.keywords import char_error_rate, keyword_recall  # noqa: E402

LABELS = {"dev": "개발용", "test_in": "테스트(범위 안)", "test_out": "테스트(범위 밖)"}


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    data = ROOT / "data"
    items = json.loads((data / "items.json").read_text(encoding="utf-8"))
    utterances = json.loads((data / "utterances.json").read_text(encoding="utf-8"))["utterances"]
    detail = sys.argv[1] if len(sys.argv) > 1 else None

    report = {}
    for path in sorted((data / "transcripts").glob("*.json")):
        run = json.loads(path.read_text(encoding="utf-8"))
        texts = {t["id"]: t for t in run["transcripts"]}
        rows = []
        for u in utterances:
            t = texts[u["id"]]
            hit, total, missed = keyword_recall(u["text"], t["text"], items)
            rows.append({"id": u["id"], "split": u["split"], "hit": hit, "total": total, "missed": missed,
                         "allFound": hit == total, "cer": min(char_error_rate(u["text"], t["text"]), 1.0),
                         "seconds": t["seconds"], "reference": u["text"], "text": t["text"]})
        summary = {}
        for split in LABELS:
            part = [r for r in rows if r["split"] == split]
            summary[split] = {
                "n": len(part),
                "keywordRecall": sum(r["hit"] for r in part) / sum(r["total"] for r in part),   # S1
                "keywordHit": sum(r["hit"] for r in part), "keywordTotal": sum(r["total"] for r in part),
                "utterancesAllFound": sum(r["allFound"] for r in part),
                "cer": sum(r["cer"] for r in part) / len(part),
                "seconds": sum(r["seconds"] for r in part) / len(part),
            }
        report[run["name"]] = {"device": run["device"], "summary": summary}

        print(f"== {run['name']} (장치: {run['device']}) ==")
        for split, s in summary.items():
            print(f"{LABELS[split]}: 핵심어 인식률(S1) {s['keywordHit']}/{s['keywordTotal']} ({s['keywordRecall']:.0%})"
                  f" | 핵심어를 다 맞힌 발화 {s['utterancesAllFound']}/{s['n']}"
                  f" | 글자 오류율 {s['cer']:.0%} | 발화당 {s['seconds']:.2f}초")
        if detail == run["name"]:
            for r in rows:
                if not r["allFound"]:
                    print(f"- {r['id']} 대본: {r['reference']}\n    STT : {r['text'][:80]}\n    놓침: {r['missed']}")

    out = ROOT / "outputs"
    out.mkdir(exist_ok=True)
    (out / "stt_comparison.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
