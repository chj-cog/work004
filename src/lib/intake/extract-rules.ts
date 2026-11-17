/**
 * 규칙 기반 정리. 받은 글 → 레코드. poc/src/extract_rules.py 를 옮긴 것이며,
 * 두 구현이 같은 답을 내는지 extract-rules.test.ts 가 확인한다.
 *
 * 확정할 수 없으면 needsReview 를 붙이고 이유를 적는다. 그때의 records 는 참고용이다.
 */
import { NUMBER_PATTERN, parseNumber } from "./korean-numbers";
import type { Extraction, IntakeContext, IntakeItems, IntakeMaterial, IntakeProject, IntakeRecord } from "./types";

const HANGUL = "가-힣";
const WEEKDAYS = "월화수목금토일";

/** 숫자 덩어리. 낱말의 처음에서만 시작한다 ("시작일이"의 "일이"를 숫자로 읽지 않도록) */
const num = (name = "num") => `(?<![${HANGUL}\\d.,])(?<${name}>${NUMBER_PATTERN})`;
const HALF = `(?<half>\\s*반(?![${HANGUL}]))?`;
const ORDER_REQUEST = /발주|주문/;
const REQUEST = /주세요|주십시오|해\s*줘|부탁/;
const HEDGE = /정도|쯤|같아|같은데|아마|대략|얼추|모르겠/;
const ZERO = /없|떨어졌|떨어져|바닥/;
const UNCHANGED = /^\s*(?:그대로|동일|변동\s*없)/;
const LATER = "미뤄|미루|밀렸|밀려|늦춰|늦어|연기";
const EARLIER = "당겨|당기|앞당";
const CORRECTION = /아니(?:요|야|다)?[,\s]/g;

const g = (m: RegExpExecArray, name: string): string => m.groups?.[name] ?? "";
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** text[start, end) 안에서 찾는다. 뒤돌아보기는 start 앞 글자를 본다 (파이썬의 pos/endpos와 같다) */
function findAll(pattern: string, flags: string, text: string, start: number, end: number): RegExpExecArray[] {
  const re = new RegExp(pattern, flags.includes("g") ? flags : flags + "g");
  const scope = text.slice(0, end);
  re.lastIndex = start;
  const found: RegExpExecArray[] = [];
  for (let m = re.exec(scope); m; m = re.exec(scope)) {
    found.push(m);
    if (m[0] === "") re.lastIndex += 1;
  }
  return found;
}

interface Mention {
  kind: "material" | "project";
  material?: IntakeMaterial;
  project?: IntakeProject;
  start: number;
  end: number;
}

function findMentions(text: string, items: IntakeItems): Mention[] {
  const candidates: { alias: string; mention: Omit<Mention, "start" | "end"> }[] = [];
  for (const material of items.materials) for (const alias of material.aliases) candidates.push({ alias, mention: { kind: "material", material } });
  for (const project of items.projects) for (const alias of project.aliases) candidates.push({ alias, mention: { kind: "project", project } });
  candidates.sort((a, b) => b.alias.length - a.alias.length); // "라벨지"를 "라벨"보다 먼저

  const mentions: Mention[] = [];
  const taken = new Array<boolean>(text.length).fill(false);
  for (const { alias, mention } of candidates) {
    // STT는 띄어쓰기를 제멋대로 한다. "큰박스", "포장 박스"도 찾도록 글자 사이의 빈칸을 허용한다
    const chars = [...alias].filter((ch) => !/\s/.test(ch));
    if (chars.length === 0) continue;
    for (const found of findAll(chars.map(escapeRe).join("\\s*"), "iu", text, 0, text.length)) {
      const start = found.index;
      const end = start + found[0].length;
      if (taken.slice(start, end).some(Boolean)) continue;
      taken.fill(true, start, end);
      mentions.push({ ...mention, start, end });
    }
  }
  return mentions.sort((a, b) => a.start - b.start);
}

/** "다섯 박스, 아니 네 박스" → 고쳐 말한 뒤쪽이 시작하는 위치 */
function afterCorrection(text: string, start: number, end: number): number {
  const found = findAll(CORRECTION.source, "g", text, start, end);
  const last = found.at(-1);
  return last ? last.index + last[0].length : start;
}

function stockRecord(material: IntakeMaterial, text: string, start: number, end: number, reasons: string[]): IntakeRecord | null {
  const units = new Map<string, number>(material.baseUnits.map((u) => [u, 1]));
  for (const pack of material.packs) units.set(pack.unit, pack.qty);
  const unitPattern = [...units.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join("|");

  let total = 0;
  let found = false;
  if (unitPattern) {
    for (const m of findAll(`${num()}\\s*(?<unit>${unitPattern})${HALF}`, "u", text, afterCorrection(text, start, end), end)) {
      const unit = g(m, "unit");
      const value = parseNumber(g(m, "num"));
      if (value === null) {
        reasons.push(`${material.name}: 수량을 숫자로 읽지 못함 (${g(m, "num")} ${unit})`);
        return null;
      }
      const half = g(m, "half") ? 0.5 : 0;
      if (half && units.get(unit) === 1) {
        reasons.push(`${material.name}: 낱개에 '반'이 붙음`);
        return null;
      }
      total += (value + half) * units.get(unit)!;
      found = true;
    }
  }
  if (!found) {
    if (ZERO.test(text.slice(start, end))) return { kind: "stock_report", materialId: material.id, qty: 0 };
    reasons.push(`${material.name}: 수량이나 단위를 찾지 못함`);
    return null;
  }
  if (!Number.isInteger(total)) {
    reasons.push(`${material.name}: 낱개 수량이 정수가 아님 (${total})`);
    return null;
  }
  return { kind: "stock_report", materialId: material.id, qty: total };
}

const toIso = (d: Date) => d.toISOString().slice(0, 10);
const fromIso = (iso: string) => new Date(`${iso}T00:00:00Z`);
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

/** 실제로 있는 날짜만 만든다 (2월 30일은 null) */
function makeDate(year: number, month: number, day: number): Date | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? d : null;
}

function findDate(text: string, start: number, end: number, today: Date, currentStart: Date | null, reasons: string[], name: string): string | null {
  // 1) "일주일 미뤄졌어요": 지금 시작일에서 계산한다. "이십사 일로 밀렸어요"는 '로'가 있어 여기 걸리지 않는다
  const shift = findAll(`${num()}\\s*(?<unit>주일|주|일)\\s*(?:씩\\s*|정도\\s*|더\\s*)?(?<dir>${LATER}|${EARLIER})`, "u", text, start, end)[0];
  if (shift) {
    const value = parseNumber(g(shift, "num"));
    if (value === null || currentStart === null) {
      reasons.push(`${name}: 며칠을 옮기는지 계산하지 못함`);
      return null;
    }
    let days = Math.trunc(value) * (g(shift, "unit") === "일" ? 1 : 7);
    if (new RegExp(`^(?:${EARLIER})`).test(g(shift, "dir"))) days = -days;
    return toIso(addDays(currentStart, days));
  }

  // 2) "다음 주 화요일": 고쳐 말했으면 마지막 요일
  const week = findAll("(이번|다음|다다음)\\s*주", "u", text, start, end)[0];
  const weekdays = findAll(`([${WEEKDAYS}])요일`, "u", text, start, end).map((m) => m[1]);
  const lastWeekday = weekdays.at(-1);
  if (week && lastWeekday) {
    const mondayOffset = (today.getUTCDay() + 6) % 7; // 월요일 = 0
    const offset = { 이번: 0, 다음: 7, 다다음: 14 }[week[1] as "이번" | "다음" | "다다음"];
    return toIso(addDays(today, -mondayOffset + offset + WEEKDAYS.indexOf(lastWeekday)));
  }
  if (lastWeekday) {
    reasons.push(`${name}: 어느 주의 ${lastWeekday}요일인지 알 수 없음`);
    return null;
  }

  // 3) "십이월 이 일", "이십사 일": 고쳐 말했으면 마지막 날짜
  const m = findAll(`(?:${num("month")}\\s*월\\s*)?${num("day")}\\s*일(?![${HANGUL}]*주)`, "u", text, start, end).at(-1);
  if (!m) return null;
  const day = parseNumber(g(m, "day"));
  const month = g(m, "month") ? parseNumber(g(m, "month")) : null;
  if (day === null || (g(m, "month") && month === null)) {
    reasons.push(`${name}: 날짜를 읽지 못함`);
    return null;
  }
  const year = today.getUTCFullYear();
  let result: Date | null;
  if (month !== null) {
    result = makeDate(year, Math.trunc(month), Math.trunc(day));
    if (result && result < today) result = makeDate(year + 1, Math.trunc(month), Math.trunc(day));
  } else {
    // 날만 말하면 오늘 이후 가장 가까운 그 날
    const thisMonth = today.getUTCMonth() + 1;
    result = makeDate(year, thisMonth, Math.trunc(day));
    if (result && result < today) result = thisMonth === 12 ? makeDate(year + 1, 1, Math.trunc(day)) : makeDate(year, thisMonth + 1, Math.trunc(day));
  }
  if (!result) {
    reasons.push(`${name}: 없는 날짜 (${m[0]})`);
    return null;
  }
  return toIso(result);
}

function scheduleRecord(
  project: IntakeProject, text: string, start: number, end: number, today: Date, currentStart: Date | null, reasons: string[],
): IntakeRecord | null {
  const name = project.name;
  const before = reasons.length;
  const record: IntakeRecord = { kind: "schedule_change", projectId: project.id };

  const newStart = findDate(text, start, end, today, currentStart, reasons, name);
  if (newStart) record.startDate = newStart;

  for (const m of findAll(`${num()}\\s*(?:개|대|세트|ea)`, "iu", text, afterCorrection(text, start, end), end)) {
    if (UNCHANGED.test(text.slice(m.index + m[0].length, end))) continue; // "수량 백 개 그대로"
    const value = parseNumber(g(m, "num"));
    if (value === null || value <= 0 || !Number.isInteger(value)) {
      reasons.push(`${name}: 수량을 숫자로 읽지 못함 (${g(m, "num")})`);
      return null;
    }
    record.productionQty = value;
  }

  // "수량은 80K입니다"처럼 수량을 말했는데 읽지 못하면, 날짜만 반영하고 넘어가지 않는다
  const segment = text.slice(start, end);
  if (/수량/.test(segment) && record.productionQty === undefined && !/그대로|동일/.test(segment)) {
    reasons.push(`${name}: 수량을 말했지만 읽지 못함`);
  }
  if (reasons.length > before) return null;
  if (record.startDate === undefined && record.productionQty === undefined) {
    reasons.push(`${name}: 바뀐 날짜나 수량을 찾지 못함`);
    return null;
  }
  return record;
}

/** 글 하나를 레코드로 정리한다 */
export function extractByRules(text: string, items: IntakeItems, context: IntakeContext): Extraction {
  const today = fromIso(context.today);
  const reasons: string[] = [];
  const records: IntakeRecord[] = [];

  if (ORDER_REQUEST.test(text)) reasons.push("발주 요청으로 보임 (재고·일정 보고가 아님)");
  else if (REQUEST.test(text)) reasons.push("보고가 아니라 부탁하는 말로 보임");
  if (!text.trim()) return { records: [], needsReview: true, reasons: ["받아 적은 글이 비어 있음"] };
  if (HEDGE.test(text)) reasons.push("어림잡아 말함");

  const mentions = findMentions(text, items);
  if (mentions.length === 0) reasons.push("부자재 목록이나 프로젝트 목록에 있는 이름을 찾지 못함");

  const leadEnd = mentions.length ? mentions[0]!.start : 0;
  if (findAll(`${num()}\\s*[${HANGUL}]`, "u", text, 0, leadEnd).some((m) => parseNumber(g(m, "num")) !== null)) {
    reasons.push("어느 품목의 수량인지 알 수 없는 숫자가 있음");
  }

  const seen = new Set<string>();
  mentions.forEach((mention, i) => {
    const end = i + 1 < mentions.length ? mentions[i + 1]!.start : text.length;
    const id = mention.kind === "material" ? mention.material!.id : mention.project!.id;
    const label = mention.kind === "material" ? mention.material!.name : mention.project!.name;
    const key = `${mention.kind}:${id}`;
    if (seen.has(key)) {
      reasons.push(`${label}: 한 발화에서 두 번 말함`);
      return;
    }
    seen.add(key);
    const record =
      mention.kind === "material"
        ? stockRecord(mention.material!, text, mention.end, end, reasons)
        : scheduleRecord(
            mention.project!, text, mention.end, end, today,
            context.projectStarts[id] ? fromIso(context.projectStarts[id]) : null, reasons,
          );
    if (record) records.push(record);
  });

  return { records, needsReview: reasons.length > 0, reasons };
}
