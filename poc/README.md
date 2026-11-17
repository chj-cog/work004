# PoC — 말로 들은 재고·일정 변경을 발주 초안까지

음성 → STT → LLM 정리 → 사람 확인 → 발주 계산 → 발주 초안.
왜 이것을 만드는지는 [문제 정의서](../docs/problem-definition.md), 순서는 [구현 계획](../docs/poc-plan.md)에 있다.

## 결과 요약

테스트 발화 30개(범위 안) 기준. 자세한 내용은 [검증 결과](../docs/evaluation.md).

| 지표 | 목표 | 결과 |
|---|---|---|
| 핵심어 인식률 (STT) | 90% 이상 | 86% |
| 정리 정확도 (STT + LLM) | 85% 이상 | 73% |
| 발주 판단 일치율 | 90% 이상 | 77% |
| 모르고 지나가는 오류 | 0건 | 3건 |

**성공 기준에 미달했다.** 지금 상태로는 사람이 모든 결과를 확인해야 한다.

## 만든 것

| 파일 | 내용 |
|---|---|
| `src/order_plan.py` | 발주 계산. 웹 앱의 계산 엔진(TypeScript)을 파이썬으로 옮긴 것 |
| `src/apply.py` | 확인된 정리 결과(재고 보고, 일정 변경)를 반영하고, 발주 초안이 어떻게 달라졌는지 비교 |
| `data/scenario/base.json` | 가상의 부자재·BOM·생산일정 (사내 수치 아님) |
| `data/items.json` | 부자재·프로젝트의 호칭과 포장 단위 (1박스 = 800개 등) |
| `data/utterances.json` | 발화 대본 61개와 정답. 녹음용 문서 [recording-script.md](../docs/recording-script.md)가 여기서 만들어진다 |
| `src/korean_numbers.py` | "천이백", "열두", "1,200" 같은 숫자 표현을 수로 바꾼다 |
| `src/extract_rules.py` | 규칙 기반 정리(기준선). 글 → 재고 보고·일정 변경 레코드, 확정할 수 없으면 "확인 필요" |
| `src/evaluate.py` | 정리 결과를 정답과 비교해 정리 정확도(S2), 발주 판단 일치율(S3), 모르고 지나가는 오류(S4)를 계산 |
| `tools/eval_rules.py` | 규칙 기반 정리를 대본 글 61개로 평가 |
| `src/stt.py` | 음성 → 글. Whisper를 PC에서 실행 |
| `src/keywords.py` | 핵심어 인식률(S1), 글자 오류율 |
| `src/extract_llm.py` | LLM 정리. PC의 Ollama를 호출한다. 지시문과 출력 형식이 여기 있다 |
| `src/review.py` | LLM이 뽑은 값을 레코드로 바꾸고(곱셈, 날짜 계산) "확인 필요"를 판단 |
| `src/pipeline.py` | 음성(또는 글) → 발주 초안까지 한 번에 |
| `tools/demo.py` | 처음부터 끝까지 한 번 돌려 보기 |
| `tools/run_stt.py`, `tools/eval_stt.py` | 녹음 받아 적기, STT 비교 |
| `tools/run_extraction.py`, `tools/report.py` | 정리 방식별 실행, 비교표 |
| `data/audio/` | 녹음 파일 61개를 넣는 곳. 목소리를 공개하지 않으려고 저장소에는 올리지 않는다 |
| `data/transcripts/` | Whisper가 받아 적은 글 (모델 5가지) |
| `data/predictions/` | 정리 방식별 결과와 LLM 응답 원문 |
| `tests/` | PRD 예시 확인, 웹 앱 엔진과 같은 답인지 80건 비교, 반영 테스트, 대본·정답 검사, 규칙 기반 정리, LLM 출력 검증, 지표 계산 |

모델을 고른 이유는 [모델 비교 기록](../docs/model-comparison.md), 한계와 추가 시도는 [한계와 다음 스텝](../docs/limits-next-steps.md)에 있다.

대본이나 정답을 고쳤다면 녹음용 문서를 다시 만든다 (`poc` 폴더에서):

```bash
.venv/Scripts/python tools/make_recording_script.py
```

## 실행

세 단계로 나뉜다. 뒤로 갈수록 준비물이 늘어난다. 명령은 따로 적지 않으면 `poc` 폴더에서 실행한다.

| 단계 | 준비물 | 할 수 있는 것 |
|---|---|---|
| A | 파이썬 | 테스트, 저장된 결과로 비교표 다시 계산, 규칙 방식으로 글 → 발주 초안 |
| B | A + [Ollama](https://ollama.com)와 `llama3.1:8b` 모델 | LLM 방식으로 글 → 발주 초안, 정리 비교 다시 실행 |
| C | B + ffmpeg + 녹음 파일 | 녹음 → 발주 초안. 녹음은 저장소에 없으므로 [녹음 대본](../docs/recording-script.md)을 보고 직접 녹음한다 |

### A. 설치와 테스트

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

macOS·Linux에서는 `.venv/Scripts/python` 대신 `.venv/bin/python`을 쓴다.

저장된 결과로 비교표를 다시 계산한다 (LLM과 녹음이 필요 없다):

```bash
.venv/Scripts/python tools/eval_stt.py
```

```bash
.venv/Scripts/python tools/report.py
```

규칙 방식으로 글 한 줄을 발주 초안까지 돌린다:

```bash
.venv/Scripts/python tools/demo.py --text "스티커 다섯 롤 반 남았어요" --method rules
```

### 브라우저에서 보기

결과 요약, 비교표를 보고 발화를 골라 직접 돌려 볼 수 있다. 이 PC 안에서만 열린다.

```bash
.venv/Scripts/python web/server.py
```

이 프로그램은 **웹 앱의 PC 도우미**이기도 하다. 켜 두면 웹 앱의 `받은 내용` 화면이 녹음을 이 PC에서 받아 적고 LLM으로 정리한다 (`/api/extract`). 허용한 웹 앱 주소에서 온 요청만 받는다.

브라우저에서 `http://localhost:8765`를 연다. 규칙 방식과 비교표는 A만으로 되고, LLM 방식은 B, "녹음을 지금 받아 적어 실행"은 C가 필요하다.

### B. LLM으로 정리 (Ollama)

Ollama를 설치하고 모델을 받는다 (약 5GB, 무료):

```bash
ollama pull llama3.1:8b
```

```bash
.venv/Scripts/python tools/demo.py --text "다사 재고 3200개입니다"
```

STT가 "나사"를 "다사"로 틀리게 적은 글이다. LLM은 나사로 알아보고, `--method rules`를 붙이면 "확인 필요"가 나온다.

정리 비교를 다시 실행한다 (방식과 입력을 바꿔 가며):

```bash
.venv/Scripts/python tools/run_extraction.py --method hybrid --model llama3.1:8b --source whisper-large-v3-turbo-hint
```

`--replay`를 붙이면 LLM을 부르지 않고 저장된 응답으로 다시 계산한다.

### C. 녹음부터 (Whisper)

ffmpeg가 설치되어 있어야 한다. Whisper 모델은 처음 실행할 때 내려받는다 (약 1.6GB).

```bash
.venv/Scripts/python tools/demo.py --audio data/audio/T05.m4a --hint
```

녹음 61개를 모두 받아 적어 비교하려면:

```bash
.venv/Scripts/python tools/run_stt.py small large-v3-turbo --hint
```

실행 예 (녹음 T05 "스크류 두 박스 반 있습니다"):

```
녹음: data/audio/T05.m4a  (받아 적기 7.04초)
받아 적은 글: 스크류 두 박스 반 있습니다.
정리 방식: hybrid@llama3.1:8b

정리 결과
  재고 보고   나사(A)  현재 재고 2,000

반영했습니다. 달라진 발주:
  나사(A)  [바뀜]  2026-11-09 2,400  →  2026-11-11 800
```

## 웹 앱 엔진과 같은 답인지 확인하는 방법

`tools/engine_fixture.test.ts`가 웹 앱 엔진을 실제로 돌려 무작위 80건의 입력과 출력을 `tests/fixtures/engine_cases.json`에 저장한다. `tests/test_engine_parity.py`는 같은 입력을 파이썬 계산에 넣어 출력이 같은지 본다.

웹 앱 엔진을 고쳤다면 픽스처를 다시 만든다 (프로젝트 폴더에서, Git Bash 기준):

```bash
UPDATE_FIXTURE=1 npx vitest run poc/tools
```
