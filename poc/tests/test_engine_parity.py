"""파이썬으로 옮긴 발주 계산이 웹 앱 계산 엔진(TypeScript)과 같은 답을 내는지 비교한다.

픽스처는 poc/tools/engine_fixture.test.ts 가 엔진을 실제로 돌려 만든 입력·출력 80건이다.
"""

import json
import math
from pathlib import Path

import pytest

from src.order_plan import calculate_plan

CASES = json.loads((Path(__file__).parent / "fixtures" / "engine_cases.json").read_text(encoding="utf-8"))


def same(a, b) -> bool:
    """숫자는 아주 작은 부동소수점 차이를 허용하고, 나머지는 정확히 같아야 한다"""
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return math.isclose(a, b, rel_tol=0, abs_tol=1e-6)
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    return a == b


@pytest.mark.parametrize("case", CASES, ids=[f"case{i + 1}" for i in range(len(CASES))])
def test_same_as_typescript_engine(case):
    result = calculate_plan(case["input"])
    issues = [{k: v for k, v in issue.items() if k != "message"} for issue in result["issues"]]

    assert same(result["orders"], case["output"]["orders"])
    assert issues == case["output"]["issues"]


def test_fixture_is_not_trivial():
    assert len(CASES) >= 50
    assert sum(1 for c in CASES if c["output"]["orders"]) > len(CASES) / 2
