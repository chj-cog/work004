"""웹 앱의 규칙 기반 정리(TypeScript)가 파이썬과 같은 답을 내는지 확인하는 데 쓰는 사례를 만든다.

    poc 폴더에서:  .venv/Scripts/python tools/rules_fixture.py
    → ../src/lib/intake/fixtures/rules-cases.json

대본 글, Whisper가 받아 적은 글, 대본 밖 표현을 모두 넣는다.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))

from src.extract_rules import extract  # noqa: E402

EXTRA = [
    "라벨두롤남았어요", "나사가 세 박스고 라벨이 두 롤", "피원이 십 일로 밀렸어요", "나사 1,200개 남았습니다.",
    "P2는 12월 1일 시작으로 바뀌었고 수량은 80개입니다.", "피원 시작이 이 일로 바뀌었어요.", "피투 건 삼 일 당겨졌어요.",
    "나사 세 롤 남았어요.", "피원 건 금요일로 바뀌었어요.", "피원 시작이 이월 삼십 일로 바뀌었어요.",
    "나사 두 박스, 나사 세 박스 있어요.", "나사 2박스 말조해 주세요", "", "세 박스 남았어요 나사",
    "피원은 24일 말고 27일로 해 주세요", "피원 수량 150으로 늘었어요", "나사못 세 박스 있습니다",
    "나사 다섯 박스, 아니 네 박스 남았어요.", "큰박스 여덟 묶음 남았습니다.", "피투 건 다다음 주 월요일로 밀렸어요",
    "피원 건 2주 미뤄졌어요", "라벨 반 롤 남았어요", "나사 만 이천 개 있습니다", "완충재 열두 봉지 반 있어요",
]


def main() -> None:
    data = ROOT / "data"
    scenario = json.loads((data / "scenario" / "base.json").read_text(encoding="utf-8"))
    items = json.loads((data / "items.json").read_text(encoding="utf-8"))
    utterances = json.loads((data / "utterances.json").read_text(encoding="utf-8"))["utterances"]

    texts = [u["text"] for u in utterances] + EXTRA
    for path in sorted((data / "transcripts").glob("*.json")):
        texts += [t["text"] for t in json.loads(path.read_text(encoding="utf-8"))["transcripts"]]
    texts = list(dict.fromkeys(t for t in texts if len(t) < 200))  # 같은 글은 한 번만

    cases = []
    for text in texts:
        result = extract(text, items, scenario)
        records = [
            {"kind": "stock_report", "materialId": r["materialId"], "qty": r["qty"]} if r["kind"] == "stock_report"
            else {k: v for k, v in {"kind": "schedule_change", "projectId": r["project"], "startDate": r.get("startDate"),
                                    "productionQty": r.get("productionQty")}.items() if v is not None}
            for r in result["records"]
        ]
        cases.append({"text": text, "records": records, "needsReview": result["needsReview"], "reasons": result["reasons"]})

    fixture = {
        "items": {
            "materials": [{"id": m["id"], "name": m["name"], "aliases": m["aliases"], "baseUnits": m["baseUnits"], "packs": m["packs"]}
                          for m in items["materials"]],
            # 파이썬 쪽은 프로젝트를 코드로만 부른다
            "projects": [{"id": p["id"], "name": p["id"], "aliases": p["aliases"]} for p in items["projects"]],
        },
        "context": {"today": scenario["today"], "projectStarts": {p["id"]: p["startDate"] for p in scenario["projects"]}},
        "cases": cases,
    }
    out = ROOT.parent / "src" / "lib" / "intake" / "fixtures" / "rules-cases.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(fixture, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(cases)}건 → {out}")


if __name__ == "__main__":
    main()
