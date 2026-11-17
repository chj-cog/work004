"""음성 → 글 (STT). Whisper를 PC에서 돌린다 (faster-whisper).

모델 파일은 처음 쓸 때 한 번 내려받고, 그 뒤로는 인터넷 없이 동작한다.
"""

from __future__ import annotations

import subprocess
import time
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16000


def read_audio(path: Path | str) -> np.ndarray:
    """녹음 파일(wav, m4a 등)을 Whisper가 받는 형태(16kHz, 한 채널)로 읽는다. ffmpeg가 설치되어 있어야 한다"""
    done = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-"],
        capture_output=True, check=False)
    if done.returncode != 0:
        raise RuntimeError(f"녹음을 읽지 못했습니다: {path} / {done.stderr.decode(errors='replace').strip()}")
    return np.frombuffer(done.stdout, dtype=np.float32)


def build_hint(items: dict) -> str:
    """품목명 힌트. Whisper에게 "이런 낱말이 나온다"고 미리 알려 주는 글이다"""
    names = [alias for m in items["materials"] for alias in m["aliases"]]
    names += [alias for p in items["projects"] for alias in p["aliases"] if not alias.isascii()]
    units = sorted({p["unit"] for m in items["materials"] for p in m["packs"]})
    return f"부자재 재고와 생산 일정 보고입니다. 품목: {', '.join(names)}. 단위: {', '.join(units)}."


def load_model(size: str, device: str = "auto"):
    """(모델, 실제로 쓴 장치). 그래픽카드를 쓸 수 없으면 CPU로 돌린다"""
    from faster_whisper import WhisperModel

    if device in ("auto", "cuda"):
        try:
            model = WhisperModel(size, device="cuda", compute_type="float16")
            return model, "cuda"
        except Exception:
            if device == "cuda":
                raise
    return WhisperModel(size, device="cpu", compute_type="int8"), "cpu"


def transcribe(model, path: Path | str, hint: str | None = None) -> tuple[str, float]:
    """(받아 적은 글, 걸린 시간 초). 시간에는 파일을 읽는 시간이 들어가지 않는다"""
    audio = read_audio(path)
    started = time.perf_counter()
    segments, _ = model.transcribe(
        audio, language="ko", beam_size=5, temperature=0.0,
        initial_prompt=hint, condition_on_previous_text=False,
    )
    text = " ".join(s.text.strip() for s in segments).strip()
    return text, time.perf_counter() - started
