"""data/utterances.json → docs/recording-script.md (녹음할 때 보고 읽는 대본).

대본과 정답은 utterances.json 한 곳에서만 고치고, 이 스크립트로 문서를 다시 만든다.

    poc 폴더에서:  .venv/Scripts/python tools/make_recording_script.py
"""

from __future__ import annotations

import json
from pathlib import Path

POC = Path(__file__).parents[1]
OUT = POC.parent / "docs" / "recording-script.md"

SECTIONS = [
    ("dev", "1. 개발용 (D01~D20)", "지시문과 규칙을 다듬을 때 쓴다. 평소 말하듯이 녹음한다."),
    ("test_in", "2. 테스트 — 범위 안 (T01~T30)", "성공 기준을 판정하는 발화다. 조용한 곳에서 평소 말하듯이 녹음한다."),
    ("test_out", "3. 테스트 — 범위 밖 조건 (X01~X11)", "일부러 어렵게 만든 발화다. **말하는 방법** 칸에 적힌 대로 녹음한다. 칸이 비어 있으면 평소대로 말한다."),
]


def describe(records: list[dict], needs_review: bool, items: dict) -> str:
    names = {m["id"]: m["name"] for m in items["materials"]}
    parts = []
    for r in records:
        if r["kind"] == "stock_report":
            parts.append(f"{names[r['materialId']]}({r['materialId']}) 재고 {r['qty']:,}")
        else:
            changes = []
            if "startDate" in r:
                changes.append(f"시작일 {r['startDate']}")
            if "productionQty" in r:
                changes.append(f"수량 {r['productionQty']:,}")
            parts.append(f"{r['project']} {', '.join(changes)}")
    if needs_review:
        parts.append("**확인 필요** (반영 없음)" if not records else "**확인 필요**")
    return " / ".join(parts)


def main() -> None:
    data = json.loads((POC / "data" / "utterances.json").read_text(encoding="utf-8"))
    items = json.loads((POC / "data" / "items.json").read_text(encoding="utf-8"))
    utterances = data["utterances"]

    lines = [
        "# 녹음 대본",
        "",
        "> 이 파일은 `poc/data/utterances.json`에서 자동으로 만든다. 문장이나 정답을 고칠 때는 그 파일을 고치고",
        "> `poc/tools/make_recording_script.py`를 다시 실행한다.",
        "",
        f"발화 {len(utterances)}개. 문장은 Claude가 지어낸 것이고, 실제 통화나 대화가 아니다.",
        "",
        "## 녹음하기 전에",
        "",
        "**먼저 대본을 훑어보고 고쳐 주세요.**",
        "- 현장에서 실제로 쓰지 않는 어색한 말투가 있으면, 평소 쓰는 말로 바꿔서 알려주세요. 품목·숫자·날짜만 그대로 두면 됩니다.",
        "- **정답** 칸이 문장과 맞는지 봐 주세요. 틀린 것이 있으면 번호와 함께 알려주세요.",
        "",
        "**녹음 방법**",
        "1. 휴대폰 기본 녹음 앱으로, **발화 하나에 파일 하나**씩 녹음합니다.",
        "2. 파일 이름은 **번호**로 합니다. 예: `D01.m4a`, `T17.m4a`, `X03.m4a` (확장자는 휴대폰이 만든 그대로)",
        "3. 대본을 읽는 느낌보다, 한 번 읽고 **외워서 말하듯이** 녹음합니다. 조금 다르게 말했어도 품목·숫자·날짜가 같으면 괜찮습니다.",
        "4. 다르게 말한 부분이 품목·숫자·날짜라면 다시 녹음하거나, 실제로 말한 내용을 알려주세요.",
        "5. 녹음 파일을 PC의 `poc/data/audio/` 폴더에 넣습니다.",
        "",
        "**주의**",
        "- 본인 목소리만 녹음합니다. 다른 사람 목소리나 실제 통화는 넣지 않습니다.",
        "- 회사 이름, 거래처 이름, 사람 이름을 말하지 않습니다.",
        "- 이 녹음은 공개 저장소에 올라갑니다. 올리고 싶지 않으면 말씀해 주세요. 녹음은 PC에만 두고 결과만 올릴 수 있습니다.",
        "",
        "## 기준이 되는 상황",
        "",
        f"- **오늘은 {data['referenceDate']} (화요일)** 이라고 가정합니다. \"다음 주 화요일\"은 11월 10일입니다.",
        "- 프로젝트: **P1**(피원, 11월 20일 시작, 100개), **P2**(피투, 11월 24일 시작, 100개)",
        "",
        "| 부자재 | 다르게 부르는 이름 | 포장 단위 |",
        "|---|---|---|",
    ]
    for m in items["materials"]:
        aliases = ", ".join(a for a in m["aliases"] if a != m["name"]) or "—"
        packs = ", ".join(f"1{p['unit']} = {p['qty']:,}{m['baseUnits'][0]}" for p in m["packs"])
        lines.append(f"| {m['name']} ({m['id']}) | {aliases} | {packs} |")

    for split, title, intro in SECTIONS:
        rows = [u for u in utterances if u["split"] == split]
        lines += ["", f"## {title}", "", intro, ""]
        if split == "test_out":
            lines += ["| 번호 | 말할 문장 | 말하는 방법 | 정답 | 조건 |", "|---|---|---|---|---|"]
        else:
            lines += ["| 번호 | 말할 문장 | 정답 | 조건 |", "|---|---|---|---|"]
        for u in rows:
            answer = describe(u["records"], u.get("needsReview", False), items)
            cells = [u["id"], u["text"]]
            if split == "test_out":
                cells.append(u.get("howToSpeak", ""))
            cells += [answer, u["condition"]]
            lines.append("| " + " | ".join(cells) + " |")

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{OUT.relative_to(POC.parent)} — 발화 {len(utterances)}개")


if __name__ == "__main__":
    main()
