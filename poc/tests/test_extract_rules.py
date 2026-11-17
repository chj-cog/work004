"""규칙 기반 정리와 한글 숫자 읽기 테스트."""

import json
from pathlib import Path

import pytest

from src.extract_rules import extract
from src.korean_numbers import parse_number

DATA = Path(__file__).parents[1] / "data"
BASE = json.loads((DATA / "scenario" / "base.json").read_text(encoding="utf-8"))
ITEMS = json.loads((DATA / "items.json").read_text(encoding="utf-8"))


def run(text):
    return extract(text, ITEMS, BASE)


def stock(material_id, qty):
    return {"kind": "stock_report", "materialId": material_id, "qty": qty}


@pytest.mark.parametrize("text, expected", [
    ("천이백", 1200), ("백오십", 150), ("이천오백", 2500), ("삼천이백", 3200), ("십이", 12),
    ("이십사", 24), ("만", 10000), ("만 이천".replace(" ", ""), 12000), ("영", 0),
    ("한", 1), ("두", 2), ("열", 10), ("열두", 12), ("스무", 20), ("서른", 30), ("스물다섯", 25),
    ("1,200", 1200), ("30", 30), ("2.5", 2.5),
])
def test_parse_number(text, expected):
    assert parse_number(text) == expected


@pytest.mark.parametrize("text", ["이삼", "십백", "", "박스", "삼사"])
def test_parse_number_rejects(text):
    assert parse_number(text) is None


def test_pack_unit_is_converted_to_pieces():
    assert run("라벨 두 롤 남았어요.") == {"records": [stock("C", 2000)], "needsReview": False, "reasons": []}


def test_half_pack_and_loose_pieces():
    assert run("스티커 다섯 롤 반 남았어요.")["records"] == [stock("C", 5500)]
    assert run("포장박스 여섯 묶음하고 낱개 스무 장 있어요.")["records"] == [stock("B", 320)]


def test_alias_containing_a_unit_word():
    """ "포장박스"와 "큰 박스"의 '박스'를 나사의 포장 단위로 읽지 않는다"""
    assert run("큰 박스 여덟 묶음 남았습니다.")["records"] == [stock("B", 400)]
    assert run("큰박스 여덟 묶음 남았습니다.")["records"] == [stock("B", 400)]


def test_zero_stock():
    assert run("스크류 다 떨어졌어요. 하나도 없습니다.")["records"] == [stock("A", 0)]
    # "밖에 없어요"는 0이 아니다
    assert run("뽁뽁이 한 봉지밖에 없어요.")["records"] == [stock("D", 500)]


def test_correction_keeps_the_later_value():
    assert run("나사 다섯, 아니 네 박스 남았어요.")["records"] == [stock("A", 3200)]
    assert run("나사 다섯 박스, 아니 네 박스 남았어요.")["records"] == [stock("A", 3200)]
    assert run("피투 건 다음 주 화요일, 아니 수요일로 당겨졌어요.")["records"] == [
        {"kind": "schedule_change", "project": "P2", "startDate": "2026-11-11"}]


def test_digits_written_by_stt():
    assert run("나사 1,200개 남았습니다.")["records"] == [stock("A", 1200)]
    assert run("라벨 2롤 남았어요.")["records"] == [stock("C", 2000)]
    assert run("P2는 12월 1일 시작으로 바뀌었고 수량은 80개입니다.")["records"] == [
        {"kind": "schedule_change", "project": "P2", "startDate": "2026-12-01", "productionQty": 80}]


def test_dates():
    def start(text):
        result = run(text)
        assert not result["needsReview"], result["reasons"]
        return result["records"][0]["startDate"]

    assert start("피원 생산 시작이 이십사 일로 밀렸어요.") == "2026-11-24"      # 날만: 오늘 이후 가장 가까운 날
    assert start("피원 시작이 이 일로 바뀌었어요.") == "2026-12-02"              # 오늘(11-03)보다 앞이면 다음 달
    assert start("피원 건 이번 주 금요일로 앞당겨졌습니다.") == "2026-11-06"
    assert start("피투 건 다음 주 월요일로 당겨졌어요.") == "2026-11-09"
    assert start("피원 건 일주일 미뤄졌어요.") == "2026-11-27"                   # 지금 시작일 11-20 기준
    assert start("피투 건 삼 일 당겨졌어요.") == "2026-11-21"                    # 지금 시작일 11-24 기준


def test_particle_after_item_name_is_not_a_number():
    """ "라벨이 두 롤"의 조사 '이'를 숫자 2로 읽지 않는다"""
    assert run("나사가 세 박스고 라벨이 두 롤")["records"] == [stock("A", 2400), stock("C", 2000)]
    assert run("피원이 십 일로 밀렸어요")["records"] == [
        {"kind": "schedule_change", "project": "P1", "startDate": "2026-11-10"}]


def test_unchanged_quantity_is_not_reported():
    assert run("피투는 수량 백 개 그대로고 시작만 삼십 일로 밀렸어요.")["records"] == [
        {"kind": "schedule_change", "project": "P2", "startDate": "2026-11-30"}]


@pytest.mark.parametrize("text, reason", [
    ("나사 두 박스 발주해 주세요.", "발주 요청"),
    ("나사 이삼 박스 정도 남은 것 같아요.", "어림"),
    ("테이프 열 롤 남았습니다.", "찾지 못함"),
    ("포장박스 열 있어요.", "수량이나 단위"),
    ("박스 세 박스 남았어요.", "찾지 못함"),
    ("피원 건은 저번에 말한 대로 바꿔 주세요.", "바뀐 날짜나 수량"),
    ("나사 세 롤 남았어요.", "수량이나 단위"),          # 나사는 롤로 세지 않는다
    ("피원 건 금요일로 바뀌었어요.", "어느 주"),
    ("피원 시작이 이월 삼십 일로 바뀌었어요.", "없는 날짜"),
    ("나사 두 박스, 나사 세 박스 있어요.", "두 번"),
    ("나사 2박스 말조해 주세요", "부탁"),                    # STT가 "발주"를 잘못 적은 실제 사례
    ("P2는 12월 1일 시작으로 바뀌었고 수량은 80K입니다.", "수량을 말했지만"),
    ("", "비어 있음"),
])
def test_needs_review(text, reason):
    result = run(text)
    assert result["needsReview"]
    assert any(reason in r for r in result["reasons"]), result["reasons"]
