/** 브라우저 안에서 녹음을 글로 바꾼다 (Whisper small, 웹 워커). 쓰는 사람의 기기에서만 돈다 */

export interface BrowserSttProgress {
  stage: "download" | "transcribing";
  percent?: number;
  device?: string;
}

export interface BrowserSttResult {
  text: string;
  seconds: number;
  device: string;
}

const SAMPLE_RATE = 16000;

/** 녹음 파일을 Whisper가 받는 형태(16kHz, 한 채널)로 바꾼다 */
export async function decodeAudio(blob: Blob): Promise<Float32Array> {
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
    const mixed = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const channel = buffer.getChannelData(c);
      for (let i = 0; i < mixed.length; i++) mixed[i] = (mixed[i] ?? 0) + (channel[i] ?? 0) / buffer.numberOfChannels;
    }
    return mixed;
  } catch {
    throw new Error("이 녹음 파일을 읽지 못했습니다. 브라우저에서 바로 녹음하거나 m4a·mp3·wav 파일을 올려 주세요.");
  } finally {
    void context.close();
  }
}

let worker: Worker | null = null;
let nextId = 1;

export function transcribeInBrowser(blob: Blob, onProgress: (p: BrowserSttProgress) => void): Promise<BrowserSttResult> {
  return decodeAudio(blob).then(
    (audio) =>
      new Promise<BrowserSttResult>((resolve, reject) => {
        worker ??= new Worker(new URL("./whisper-worker.ts", import.meta.url), { type: "module" });
        const id = nextId++;
        const current = worker;
        const handle = (event: MessageEvent) => {
          const m = event.data as { id: number; type: string; [key: string]: unknown };
          if (m.id !== id) return;
          if (m.type === "download") onProgress({ stage: "download", percent: Number(m.percent) });
          else if (m.type === "transcribing") onProgress({ stage: "transcribing", device: String(m.device) });
          else {
            current.removeEventListener("message", handle);
            if (m.type === "done") resolve({ text: String(m.text), seconds: Number(m.seconds), device: String(m.device) });
            else reject(new Error(`받아 적지 못했습니다: ${String(m.message)}`));
          }
        };
        current.addEventListener("message", handle);
        current.postMessage({ id, audio }, [audio.buffer]);
      }),
  );
}
