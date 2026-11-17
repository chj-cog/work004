"""처음부터 끝까지 한 번 돌려 본다: 녹음(또는 글) → 받아 적기 → 정리 → 발주 초안.

    poc 폴더에서:
    .venv/Scripts/python tools/demo.py --text "스티커 다섯 롤 반 남았어요"
    .venv/Scripts/python tools/demo.py --text "스티커 다섯 롤 반 남았어요" --method rules      (Ollama 없이)
    .venv/Scripts/python tools/demo.py --audio data/audio/T05.m4a                              (녹음, Whisper + Ollama)

    --method  hybrid(기본, LLM) | structured | plain | rules
    --model   Ollama 모델 (기본 llama3.1:8b)
    --stt     Whisper 크기 (기본 large-v3-turbo)
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))

from src.pipeline import format_report, run_audio, run_text  # noqa: E402


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--text")
    source.add_argument("--audio")
    parser.add_argument("--method", default="hybrid", choices=["hybrid", "structured", "plain", "rules"])
    parser.add_argument("--model", default="llama3.1:8b")
    parser.add_argument("--stt", default="large-v3-turbo")
    parser.add_argument("--hint", action="store_true", help="Whisper에 품목명 힌트를 준다")
    args = parser.parse_args()

    data = ROOT / "data"
    scenario = json.loads((data / "scenario" / "base.json").read_text(encoding="utf-8"))
    items = json.loads((data / "items.json").read_text(encoding="utf-8"))

    if args.audio:
        from src.stt import build_hint, load_model
        stt_model, _ = load_model(args.stt, "cpu")
        result = run_audio(args.audio, items, scenario, stt_model, args.method, args.model,
                           build_hint(items) if args.hint else None)
    else:
        result = run_text(args.text, items, scenario, args.method, args.model)
    print(format_report(result, items))


if __name__ == "__main__":
    main()
