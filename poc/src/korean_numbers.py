"""한글로 적힌 숫자를 수로 바꾼다. STT는 "천이백"이라고 적기도 하고 "1,200"이라고 적기도 해서 둘 다 받는다."""

from __future__ import annotations

import re

_SINO_DIGITS = {"일": 1, "이": 2, "삼": 3, "사": 4, "오": 5, "육": 6, "칠": 7, "팔": 8, "구": 9}
_SINO_PLACES = {"십": 10, "백": 100, "천": 1000}
_NATIVE_TENS = {"열": 10, "스물": 20, "스무": 20, "서른": 30, "마흔": 40, "쉰": 50,
                "예순": 60, "일흔": 70, "여든": 80, "아흔": 90}
_NATIVE_ONES = {"하나": 1, "한": 1, "둘": 2, "두": 2, "셋": 3, "세": 3, "넷": 4, "네": 4,
                "다섯": 5, "여섯": 6, "일곱": 7, "여덟": 8, "아홉": 9}

#: 숫자를 이룰 수 있는 글자. 이 글자들이 이어진 덩어리만 숫자 후보로 본다
NUMBER_CHARS = "".join(sorted(set("영공만" + "".join(_SINO_DIGITS) + "".join(_SINO_PLACES)
                                  + "".join(_NATIVE_TENS) + "".join(_NATIVE_ONES))))
NUMBER_PATTERN = rf"(?:\d[\d,]*(?:\.\d+)?|[{NUMBER_CHARS}]+)"

_COUNTERS = ["주일", "박스", "묶음", "봉지", "세트", "롤", "개", "장", "매", "일", "월", "주"]
# 낱말의 처음에서 시작하고, 바로 뒤에 세는 말이 오는 한글 숫자만 찾는다
_KOREAN_NUMBER = re.compile(rf"(?<![가-힣\d.,])([{NUMBER_CHARS}]+)(?=\s*(?:{'|'.join(_COUNTERS)}))")
_ANY_NUMBER = re.compile(rf"(?<![가-힣\d.,]){NUMBER_PATTERN}")


def normalize_numbers(text: str) -> str:
    """세는 말 앞의 한글 숫자를 아라비아 숫자로 바꾼다. "천이백 개" → "1200 개", "십이월 일 일" → "12월 1 일" """
    def replace(match: re.Match) -> str:
        value = parse_number(match[1])
        return match[1] if value is None else str(value)
    return _KOREAN_NUMBER.sub(replace, text)


def numbers_in(text: str) -> set[float]:
    """글에 나온 수를 모두 모은다 (한글이든 숫자든)"""
    found = set()
    for match in _ANY_NUMBER.finditer(text):
        value = parse_number(match[0])
        if value is not None:
            found.add(float(value))
    return found


def parse_number(text: str) -> float | None:
    """"천이백" → 1200, "열두" → 12, "1,200" → 1200. 숫자로 읽을 수 없으면 None ("이삼" 같은 어림수 포함)"""
    text = text.strip()
    if not text:
        return None
    if re.fullmatch(r"\d[\d,]*(\.\d+)?", text):
        value = float(text.replace(",", ""))
        return int(value) if value.is_integer() else value
    if text in ("영", "공"):
        return 0
    native = _parse_native(text)
    return native if native is not None else _parse_sino(text)


def _parse_native(text: str) -> int | None:
    total, rest = 0, text
    for word, value in sorted(_NATIVE_TENS.items(), key=lambda kv: -len(kv[0])):
        if rest.startswith(word):
            total, rest = value, rest[len(word):]
            break
    if rest:
        if rest not in _NATIVE_ONES:
            return None
        total += _NATIVE_ONES[rest]
    return total or None


def _parse_sino(text: str) -> int | None:
    total = 0      # 만 단위까지 더한 값
    section = 0    # 만 아래 값
    digit = 0      # 자릿수 앞에 놓인 숫자
    last_place = 10 ** 9
    for ch in text:
        if ch in _SINO_DIGITS:
            if digit:              # "이삼"처럼 숫자가 연달아 나오면 수가 아니다
                return None
            digit = _SINO_DIGITS[ch]
        elif ch in _SINO_PLACES:
            place = _SINO_PLACES[ch]
            if place >= last_place:  # "십백"처럼 자릿수가 커지면 수가 아니다
                return None
            section += (digit or 1) * place
            digit, last_place = 0, place
        elif ch == "만":
            if total:
                return None
            total = ((section + digit) or 1) * 10000
            section, digit, last_place = 0, 0, 10 ** 9
        else:
            return None
    return (total + section + digit) or None
