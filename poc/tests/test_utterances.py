"""발화 대본과 정답에 모순이 없는지 검사한다."""

import json
from collections import Counter
from pathlib import Path

import pytest

from src.apply import apply_records
from src.order_plan import calculate_plan

DATA = Path(__file__).parents[1] / "data"
BASE = json.loads((DATA / "scenario" / "base.json").read_text(encoding="utf-8"))
ITEMS = json.loads((DATA / "items.json").read_text(encoding="utf-8"))
UTTERANCES = json.loads((DATA / "utterances.json").read_text(encoding="utf-8"))["utterances"]


def test_split_sizes():
    assert Counter(u["split"] for u in UTTERANCES) == {"dev": 20, "test_in": 30, "test_out": 11}


def test_ids_and_sentences_are_unique():
    assert len({u["id"] for u in UTTERANCES}) == len(UTTERANCES)
    # 테스트 문장이 개발용과 겹치면 지시문이 테스트를 외운 것과 같아진다
    assert len({u["text"] for u in UTTERANCES}) == len(UTTERANCES)


def test_items_match_scenario():
    assert {m["id"] for m in ITEMS["materials"]} == {m["id"] for m in BASE["materials"]}
    assert {p["id"] for p in ITEMS["projects"]} == {p["id"] for p in BASE["projects"]}
    aliases = [a for m in ITEMS["materials"] for a in m["aliases"]]
    assert len(aliases) == len(set(aliases)), "한 호칭이 두 부자재를 가리키면 안 된다"


@pytest.mark.parametrize("u", UTTERANCES, ids=[u["id"] for u in UTTERANCES])
def test_answer_can_be_applied(u):
    """정답 레코드는 그대로 반영되어 발주 계산까지 오류 없이 가야 한다"""
    if u.get("needsReview"):
        assert u["records"] == [], "확인 필요 발화는 반영할 내용이 없어야 한다"
        assert u.get("note"), "왜 확인이 필요한지 적는다"
        return
    assert u["records"], "반영할 내용이 없으면 확인 필요로 표시한다"
    changed = apply_records(BASE, u["records"])
    assert changed != BASE, "정답이 기준 상황과 같으면, 아무것도 뽑지 못해도 맞은 것으로 판정된다"
    assert calculate_plan(changed)["issues"] == []


def test_in_scope_test_set_is_never_review_only():
    assert not any(u.get("needsReview") for u in UTTERANCES if u["split"] == "test_in")
