const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 한국 시간 기준 오늘 (YYYY-MM-DD) */
export function todayInSeoul(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
}

/** 2026-11-09 → 11-09(월) */
export function formatDate(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return `${iso.slice(5)}(${WEEKDAYS[dow]})`;
}

export function formatQty(qty: number): string {
  return qty.toLocaleString("ko-KR");
}
