/** Whisper가 말이 끝난 뒤 지어내는 인사말을 뗀다 ("감사합니다." 등). PoC에서 큰 모델이 5건에 덧붙였다 */
export function cleanTranscript(text: string): string {
  return text.replace(/\s*(?:시청해 주셔서 )?감사합니다[.!]?\s*$/u, "").trim();
}
