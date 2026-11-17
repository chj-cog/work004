# PoC — 말로 들은 재고·일정 변경을 발주 초안까지

음성 → STT → LLM 정리 → 사람 확인 → 발주 계산 → 발주 초안.
왜 이것을 만드는지는 [문제 정의서](../docs/problem-definition.md), 순서는 [구현 계획](../docs/poc-plan.md)에 있다.

## 지금까지 만든 것 (1단계)

| 파일 | 내용 |
|---|---|
| `src/order_plan.py` | 발주 계산. 웹 앱의 계산 엔진(TypeScript)을 파이썬으로 옮긴 것 |
| `src/apply.py` | 확인된 정리 결과(재고 보고, 일정 변경)를 반영하고, 발주 초안이 어떻게 달라졌는지 비교 |
| `data/scenario/base.json` | 가상의 부자재·BOM·생산일정 (사내 수치 아님) |
| `tests/` | PRD 예시 확인, 웹 앱 엔진과 같은 답인지 80건 비교, 반영 테스트 |

STT, LLM 정리, 노트북은 아직 없다.

## 실행

파이썬 3.10 이상. 프로젝트 폴더에서:

```bash
python -m venv poc/.venv
```

```bash
poc/.venv/Scripts/python -m pip install -r poc/requirements.txt
```

```bash
cd poc
```

```bash
.venv/Scripts/python -m pytest -q
```

macOS·Linux에서는 `poc/.venv/Scripts/python` 대신 `poc/.venv/bin/python`을 쓴다.

## 웹 앱 엔진과 같은 답인지 확인하는 방법

`tools/engine_fixture.test.ts`가 웹 앱 엔진을 실제로 돌려 무작위 80건의 입력과 출력을 `tests/fixtures/engine_cases.json`에 저장한다. `tests/test_engine_parity.py`는 같은 입력을 파이썬 계산에 넣어 출력이 같은지 본다.

웹 앱 엔진을 고쳤다면 픽스처를 다시 만든다 (프로젝트 폴더에서, Git Bash 기준):

```bash
UPDATE_FIXTURE=1 npx vitest run poc/tools
```
