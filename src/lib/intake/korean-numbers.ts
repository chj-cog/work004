/** 한글로 적힌 숫자를 수로 바꾼다. poc/src/korean_numbers.py 를 옮긴 것 */

const SINO_DIGITS: Record<string, number> = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
const SINO_PLACES: Record<string, number> = { 십: 10, 백: 100, 천: 1000 };
const NATIVE_TENS: Record<string, number> = { 열: 10, 스물: 20, 스무: 20, 서른: 30, 마흔: 40, 쉰: 50, 예순: 60, 일흔: 70, 여든: 80, 아흔: 90 };
const NATIVE_ONES: Record<string, number> = {
  하나: 1, 한: 1, 둘: 2, 두: 2, 셋: 3, 세: 3, 넷: 4, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9,
};

/** 숫자를 이룰 수 있는 글자. 이 글자들이 이어진 덩어리만 숫자 후보로 본다 */
export const NUMBER_CHARS = [
  ...new Set(["영", "공", "만", ...Object.keys(SINO_DIGITS), ...Object.keys(SINO_PLACES), ...Object.keys(NATIVE_TENS), ...Object.keys(NATIVE_ONES)].join("")),
].join("");
export const NUMBER_PATTERN = `(?:\\d[\\d,]*(?:\\.\\d+)?|[${NUMBER_CHARS}]+)`;

/** "천이백" → 1200, "열두" → 12, "1,200" → 1200. 숫자로 읽을 수 없으면 null ("이삼" 같은 어림수 포함) */
export function parseNumber(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^\d[\d,]*(\.\d+)?$/.test(text)) return Number(text.replaceAll(",", ""));
  if (text === "영" || text === "공") return 0;
  return parseNative(text) ?? parseSino(text);
}

function parseNative(text: string): number | null {
  let total = 0;
  let rest = text;
  for (const word of Object.keys(NATIVE_TENS).sort((a, b) => b.length - a.length)) {
    if (rest.startsWith(word)) {
      total = NATIVE_TENS[word] ?? 0;
      rest = rest.slice(word.length);
      break;
    }
  }
  if (rest) {
    if (!(rest in NATIVE_ONES)) return null;
    total += NATIVE_ONES[rest] ?? 0;
  }
  return total || null;
}

function parseSino(text: string): number | null {
  let total = 0; // 만 단위까지 더한 값
  let section = 0; // 만 아래 값
  let digit = 0; // 자릿수 앞에 놓인 숫자
  let lastPlace = 1e9;
  for (const ch of text) {
    if (ch in SINO_DIGITS) {
      if (digit) return null; // "이삼"처럼 숫자가 연달아 나오면 수가 아니다
      digit = SINO_DIGITS[ch] ?? 0;
    } else if (ch in SINO_PLACES) {
      const place = SINO_PLACES[ch] ?? 1;
      if (place >= lastPlace) return null;
      section += (digit || 1) * place;
      digit = 0;
      lastPlace = place;
    } else if (ch === "만") {
      if (total) return null;
      total = (section + digit || 1) * 10000;
      section = 0;
      digit = 0;
      lastPlace = 1e9;
    } else {
      return null;
    }
  }
  return total + section + digit || null;
}
