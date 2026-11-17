"""data/predictions/ 에 저장된 결과를 한 표로 모은다 (마크다운). LLM이나 녹음 없이 돌릴 수 있다.

    poc 폴더에서:  .venv/Scripts/python tools/report.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).parents[1]
ORDER = ["rules", "plain", "structured", "hybrid", "hybrid2", "cascade"]


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    runs = []
    for path in (ROOT / "data" / "predictions").glob("*.json"):
        run = json.loads(path.read_text(encoding="utf-8"))
        if run["split"] != "all":
            continue
        seconds = [r["seconds"] for r in run["results"] if r.get("seconds")]
        run["avgSeconds"] = sum(seconds) / len(seconds) if seconds else None
        runs.append(run)
    runs.sort(key=lambda r: (r["source"], ORDER.index(r["method"].split("@")[0]), r["method"]))

    print("| 입력 | 방식 | 범위 안 30: 정확도(S2) | 발주 일치(S3) | 조용한 오류(S4) | 확인 필요 | 범위 밖 11: 정확도 | 조용한 오류 | 발화당 시간 |")
    print("|---|---|---|---|---|---|---|---|---|")
    for run in runs:
        a, b = run["summary"]["test_in"], run["summary"]["test_out"]
        time = "1ms 미만" if run["avgSeconds"] is None else f"{run['avgSeconds']:.1f}초"
        print(f"| {run['source']} | {run['method']} | {a['correct']}/{a['n']} ({a['accuracy']:.0%}) | {a['ordersMatch']}/{a['n']} ({a['ordersMatchRate']:.0%})"
              f" | {a['silentErrors']}건 | {a['flagged']}건 | {b['correct']}/{b['n']} | {b['silentErrors']}건 | {time} |")


if __name__ == "__main__":
    main()
