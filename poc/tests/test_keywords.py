"""핵심어 인식률(S1)과 글자 오류율 테스트."""

import json
from pathlib import Path

from src.keywords import char_error_rate, keyword_recall, keywords

ITEMS = json.loads((Path(__file__).parents[1] / "data" / "items.json").read_text(encoding="utf-8"))


def test_same_meaning_written_differently_counts_as_found():
    hit, total, missed = keyword_recall("스티커 두 롤 남았어요.", "스티커 2롤 남았어요", ITEMS)
    assert (hit, total, missed) == (2, 2, [])
    # 호칭이 달라도 같은 품목이면 맞은 것으로 본다
    assert keyword_recall("스티커 두 롤", "라벨 두 롤", ITEMS)[:2] == (2, 2)


def test_wrong_item_or_number_is_missed():
    assert keyword_recall("라벨 두 롤 남았어요.", "다들 두롤 남았어요", ITEMS)[2] == [("item", "C")]
    assert keyword_recall("나사 세 박스 있습니다.", "나사 새 박스 있습니다", ITEMS)[2] == [("quantity", 3.0, "박스")]


def test_alias_is_not_counted_as_a_unit():
    assert keywords("포장박스 열 묶음", ITEMS) == {("item", "B"): 1, ("quantity", 10.0, "묶음"): 1}


def test_dates_half_and_weekdays():
    found = keywords("피투 건 다음 주 화요일, 나사 두 박스 반, 십이월 일 일", ITEMS)
    assert found[("week", "다음")] == 1 and found[("weekday", "화")] == 1 and found[("half",)] == 1
    assert found[("quantity", 12.0, "월")] == 1 and found[("quantity", 1.0, "일")] == 1


def test_char_error_rate():
    assert char_error_rate("라벨 두 롤 남았어요.", "라벨두롤남았어요") == 0
    assert char_error_rate("라벨 두 롤", "나벨 두 롤") == 0.25
    assert char_error_rate("", "") == 0
