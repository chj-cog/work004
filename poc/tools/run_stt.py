"""녹음 61개를 Whisper로 받아 적어 data/transcripts/ 에 저장한다.

    poc 폴더에서:
    .venv/Scripts/python tools/run_stt.py base small large-v3-turbo
    .venv/Scripts/python tools/run_stt.py small --hint        (품목명 힌트를 준 경우)

녹음은 저장소에 없으므로(목소리 비공개) 이 단계는 녹음을 가진 사람만 돌릴 수 있다.
결과 글은 저장소에 올리므로, 뒤 단계는 누구나 다시 돌릴 수 있다.
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))

from src.stt import build_hint, load_model, transcribe  # noqa: E402


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("models", nargs="+", help="Whisper 모델 크기: tiny, base, small, medium, large-v3-turbo 등")
    parser.add_argument("--hint", action="store_true", help="품목명 힌트를 준다")
    parser.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    args = parser.parse_args()

    data = ROOT / "data"
    items = json.loads((data / "items.json").read_text(encoding="utf-8"))
    ids = [u["id"] for u in json.loads((data / "utterances.json").read_text(encoding="utf-8"))["utterances"]]
    audio = {p.stem: p for p in (data / "audio").iterdir() if p.suffix.lower() in (".wav", ".m4a", ".mp3", ".3gp")}
    missing = [i for i in ids if i not in audio]
    if missing:
        sys.exit(f"녹음이 없습니다: {missing}")

    hint = build_hint(items) if args.hint else None
    out_dir = data / "transcripts"
    out_dir.mkdir(exist_ok=True)

    for size in args.models:
        model, device = load_model(size, args.device)
        try:
            transcribe(model, audio[ids[0]])  # 첫 실행은 준비 시간이 섞이므로 재지 않는다
        except Exception as error:  # 그래픽카드용 라이브러리가 없으면 여기서 실패한다
            if device != "cuda" or args.device == "cuda":
                raise
            print(f"[{size}] 그래픽카드로 돌리지 못해 CPU로 바꿉니다 ({type(error).__name__})")
            model, device = load_model(size, "cpu")
            transcribe(model, audio[ids[0]])

        rows = []
        for uid in ids:
            text, seconds = transcribe(model, audio[uid], hint)
            rows.append({"id": uid, "text": text, "seconds": round(seconds, 3)})
            print(f"[{size}{'+hint' if hint else ''}] {uid} {seconds:5.2f}s  {text}")

        name = f"whisper-{size}{'-hint' if hint else ''}"
        (out_dir / f"{name}.json").write_text(json.dumps(
            {"name": name, "model": size, "hint": hint, "device": device, "transcripts": rows},
            ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"저장: {out_dir / (name + '.json')}  (장치: {device})")
        del model


if __name__ == "__main__":
    main()
