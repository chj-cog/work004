/**
 * 웹 앱 계산 엔진의 입력·출력을 파일로 내보낸다. 파이썬으로 옮긴 계산(poc/src/order_plan.py)이
 * 같은 입력에 같은 답을 내는지 poc/tests/test_engine_parity.py 가 이 파일로 비교한다.
 *
 * 엔진을 고쳐서 이 테스트가 실패하면:  UPDATE_FIXTURE=1 npx vitest run poc/tools
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { calculatePlan, type BomItem, type Material, type PlanInput, type Project } from "../../src/engine";

const FIXTURE = fileURLToPath(new URL("../tests/fixtures/engine_cases.json", import.meta.url));
const CASES = 80;

/** 재현 가능한 의사 난수 (mulberry32) */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function scenario(seed: number): PlanInput {
  const r = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = <T,>(xs: T[]) => xs[int(0, xs.length - 1)]!;
  const today = addDays("2026-11-02", int(0, 60));

  const materials: Material[] = Array.from({ length: int(1, 4) }, (_, i) => ({
    id: `M${i}`,
    name: `M${i}`,
    // 가끔 잘못된 발주 단위를 섞어 오류 처리도 비교한다
    orderUnit: r() < 0.05 ? 0 : pick([100, 250, 500, 800, 1500]),
    moq: r() < 0.4 ? int(1, 40) * 100 : null,
    leadTimeBdays: int(0, 20),
    stockQty: int(0, 3000),
  }));
  const bomItems: BomItem[] = [];
  for (let p = 0; p < 3; p++) {
    for (const m of materials) {
      if (r() < 0.7) bomItems.push({ productId: `X${p}`, materialId: m.id, qtyPerUnit: r() < 0.2 ? pick([0.1, 0.25, 1.5]) : int(1, 20) });
    }
  }
  const projects: Project[] = Array.from({ length: int(1, 8) }, (_, i) => ({
    id: `P${i}`,
    name: `P${i}`,
    // X3은 BOM이 없는 제품
    productId: `X${r() < 0.05 ? 3 : int(0, 2)}`,
    productionQty: int(1, 300),
    startDate: addDays(today, int(-5, 90)),
    status: r() < 0.85 ? "planned" : pick(["in_progress", "done", "cancelled"] as const),
  }));
  const holidays = [...new Set(Array.from({ length: int(0, 10) }, () => addDays(today, int(-30, 90))))];

  return {
    today,
    materials,
    bomItems,
    projects,
    holidays,
    ...(r() < 0.3 ? { openOrders: [{ materialId: "M0", qty: int(1, 20) * 100 }] } : {}),
    ...(r() < 0.3 ? { holidayYears: [2026] } : {}),
    ...(r() < 0.3 ? { settings: { bufferBdays: int(2, 3), imminentBdays: int(1, 5), mergeWindowBdays: int(0, 7) } } : {}),
  };
}

describe("계산 엔진 → 파이썬 비교용 픽스처", () => {
  const cases = Array.from({ length: CASES }, (_, i) => {
    const input = scenario(i + 1);
    const { orders, issues } = calculatePlan(input);
    // 오류 문구는 비교하지 않는다 (코드와 대상만)
    return { input, output: { orders, issues: issues.map(({ message: _message, ...rest }) => rest) } };
  });
  // undefined 필드를 없앤 순수 JSON으로 비교한다
  const plain = JSON.parse(JSON.stringify(cases));

  it("파일이 현재 엔진의 출력과 같다", () => {
    if (process.env.UPDATE_FIXTURE || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `[\n${cases.map((c) => JSON.stringify(c)).join(",\n")}\n]\n`);
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(plain);
  });

  it("발주가 있는 경우와 오류가 있는 경우가 모두 들어 있다", () => {
    expect(cases.filter((c) => c.output.orders.length > 0).length).toBeGreaterThan(CASES / 2);
    expect(cases.some((c) => c.output.issues.length > 0)).toBe(true);
    expect(cases.some((c) => c.output.orders.some((o) => o.moqApplied))).toBe(true);
    expect(cases.some((c) => c.output.orders.some((o) => o.delayRisk))).toBe(true);
  });
});
