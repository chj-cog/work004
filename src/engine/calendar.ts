import type { ISODate } from "./types";

const DAY_MS = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidISODate(value: string): boolean {
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** 1970-01-01부터 센 날 수. 시간대 영향을 받지 않도록 UTC 기준으로 다룬다 */
function toDayNumber(value: ISODate): number {
  if (!isValidISODate(value)) throw new Error(`잘못된 날짜: ${value}`);
  const [y, mo, d] = value.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, mo - 1, d) / DAY_MS;
}

function fromDayNumber(n: number): ISODate {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function yearOf(value: ISODate): number {
  return Number(value.slice(0, 4));
}

export interface BusinessCalendar {
  isBusinessDay(date: ISODate): boolean;
  /** date에서 앞으로(과거로) 영업일을 n개 센 날 */
  subtractBusinessDays(date: ISODate, n: number): ISODate;
  /** date에서 뒤로(미래로) 영업일을 n개 센 날 */
  addBusinessDays(date: ISODate, n: number): ISODate;
  /** from 다음 날부터 to까지의 영업일 수. to가 from보다 이르면 음수 */
  businessDaysBetween(from: ISODate, to: ISODate): number;
  /** date가 영업일이면 그대로, 아니면 직전 영업일 */
  previousBusinessDay(date: ISODate): ISODate;
}

/** 영업일 = 월~금 중 휴일 목록에 없는 날 */
export function createCalendar(holidays: Iterable<ISODate>): BusinessCalendar {
  const holidaySet = new Set<number>();
  for (const h of holidays) holidaySet.add(toDayNumber(h));

  const isBusinessDayNum = (n: number): boolean => {
    // 1970-01-01은 목요일 (0 = 일요일)
    const dow = (((n % 7) + 7) % 7 + 4) % 7;
    return dow !== 0 && dow !== 6 && !holidaySet.has(n);
  };

  const step = (date: ISODate, n: number, dir: 1 | -1): ISODate => {
    if (!Number.isInteger(n) || n < 0) throw new Error(`영업일 수는 0 이상의 정수여야 합니다: ${n}`);
    let day = toDayNumber(date);
    let left = n;
    while (left > 0) {
      day += dir;
      if (isBusinessDayNum(day)) left--;
    }
    return fromDayNumber(day);
  };

  const between = (from: number, to: number): number => {
    let count = 0;
    for (let d = from + 1; d <= to; d++) if (isBusinessDayNum(d)) count++;
    return count;
  };

  return {
    isBusinessDay: (date) => isBusinessDayNum(toDayNumber(date)),
    subtractBusinessDays: (date, n) => step(date, n, -1),
    addBusinessDays: (date, n) => step(date, n, 1),
    businessDaysBetween(from, to) {
      const a = toDayNumber(from);
      const b = toDayNumber(to);
      return b >= a ? between(a, b) : -between(b, a);
    },
    previousBusinessDay(date) {
      let day = toDayNumber(date);
      while (!isBusinessDayNum(day)) day--;
      return fromDayNumber(day);
    },
  };
}
