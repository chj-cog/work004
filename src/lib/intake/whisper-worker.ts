/// <reference lib="webworker" />
/**
 * 브라우저 안에서 Whisper로 음성을 글로 바꾼다 (웹 워커). 음성은 이 기기 밖으로 나가지 않는다.
 * 모델 파일은 처음 한 번 내려받아 브라우저에 저장하고, 그 뒤로는 인터넷 없이 쓴다.
 */
import { pipeline, env } from "@huggingface/transformers";
import { cleanTranscript } from "./clean-transcript";

const MODEL = "Xenova/whisper-small";

env.allowLocalModels = false;

type Recognizer = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;
let recognizer: Promise<{ run: Recognizer; device: string }> | null = null;

async function load(report: (message: Record<string, unknown>) => void) {
  const progress_callback = (p: { status?: string; file?: string; progress?: number }) => {
    if (p.status === "progress" && typeof p.progress === "number") report({ type: "download", file: p.file, percent: Math.round(p.progress) });
  };
  const hasGpu = typeof navigator !== "undefined" && "gpu" in navigator;
  if (hasGpu) {
    try {
      const run = (await pipeline("automatic-speech-recognition", MODEL, {
        device: "webgpu",
        dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
        progress_callback,
      })) as unknown as Recognizer;
      return { run, device: "그래픽카드" };
    } catch {
      /* 그래픽카드로 못 돌리면 CPU로 */
    }
  }
  const run = (await pipeline("automatic-speech-recognition", MODEL, { device: "wasm", dtype: "q8", progress_callback })) as unknown as Recognizer;
  return { run, device: "CPU" };
}

self.onmessage = async (event: MessageEvent<{ id: number; audio: Float32Array }>) => {
  const { id, audio } = event.data;
  const report = (message: Record<string, unknown>) => self.postMessage({ id, ...message });
  try {
    recognizer ??= load(report);
    const { run, device } = await recognizer;
    report({ type: "transcribing", device });
    const started = performance.now();
    const output = await run(audio, { language: "korean", task: "transcribe", chunk_length_s: 30, stride_length_s: 5 });
    const text = (Array.isArray(output) ? output.map((o) => o.text).join(" ") : output.text).trim();
    report({ type: "done", text: cleanTranscript(text), seconds: Math.round((performance.now() - started) / 100) / 10, device });
  } catch (error) {
    recognizer = null; // 다음에 다시 시도할 수 있게
    report({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
