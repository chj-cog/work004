"""핵심어 인식률(S1)과 글자 오류율. STT가 받아 적은 글을 대본과 비교한다.

핵심어는 발주 계산에 영향을 주는 표현이다.
    품목·프로젝트   "스티커" → 라벨(C)        호칭이 달라도 같은 품목이면 같다고 본다
    숫자 + 단위      "두 롤", "2롤" → (2, 롤)  한글로 적든 숫자로 적든 같다고 본다
    반               "두 박스 반"
    요일, 주         "다음 주 화요일"
핵심어 인식률 = 대본의 핵심어 중 STT 글에도 있는 것의 비율.
"""

from __future__ import annotations

import re
from collections import Counter

from .extract_rules import _HANGUL, _find_mentions, _num
from .korean_numbers import parse_number

_UNITS = ["주일", "박스", "묶음", "봉지", "세트", "롤", "개", "장", "매", "일", "월", "주"]
_QUANTITY = re.compile(rf"{_num()}\s*(?P<unit>{'|'.join(_UNITS)})")
_HALF = re.compile(rf"반(?![{_HANGUL}])")
_WEEKDAY = re.compile(r"([월화수목금토일])요일")
_WEEK = re.compile(r"(이번|다음|다다음)\s*주")


def keywords(text: str, items: dict) -> Counter:
    found: Counter = Counter()
    masked = list(text)
    for mention in _find_mentions(text, items):
        found[("item", mention["item"]["id"])] += 1
        # 호칭 속의 "박스"를 단위로 세지 않게 가린다. 길이는 그대로 둔다
        for i in range(mention["start"], mention["end"]):
            masked[i] = "#"
    rest = "".join(masked)
    for m in _QUANTITY.finditer(rest):
        value = parse_number(m["num"])
        if value is not None:
            found[("quantity", float(value), m["unit"])] += 1
    found[("half",)] += len(_HALF.findall(rest))
    for day in _WEEKDAY.findall(rest):
        found[("weekday", day)] += 1
    for week in _WEEK.findall(rest):
        found[("week", week)] += 1
    return +found  # 0인 항목은 뺀다


def keyword_recall(reference: str, hypothesis: str, items: dict) -> tuple[int, int, list]:
    """(맞게 받아 적은 핵심어 수, 대본의 핵심어 수, 놓친 핵심어)"""
    ref, hyp = keywords(reference, items), keywords(hypothesis, items)
    hit = sum((ref & hyp).values())
    return hit, sum(ref.values()), sorted((ref - hyp).elements(), key=repr)


def _strip(text: str) -> str:
    return re.sub(r"[^0-9A-Za-z가-힣]", "", text).lower()


def char_error_rate(reference: str, hypothesis: str) -> float:
    """글자 오류율. 띄어쓰기와 문장부호는 빼고 센다. "두"와 "2"는 다른 글자로 세므로 참고용이다"""
    ref, hyp = _strip(reference), _strip(hypothesis)
    if not ref:
        return 0.0 if not hyp else 1.0
    previous = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, start=1):
        current = [i]
        for j, h in enumerate(hyp, start=1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (r != h)))
        previous = current
    return previous[-1] / len(ref)
