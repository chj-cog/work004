/**
 * PRD §7 수용 기준(AC1~AC6)을 무작위 시나리오 수백 개로 검사한다.
 */
import { describe, expect, it } from "vitest";
import { createCalendar } from "./calendar";
import { calculatePlan } from "./plan";
import { DEFAULT_SETTINGS, type BomItem, type Material, type PlanInput, type Project } from "./types";

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

function randomScenario(seed: number): PlanInput {
  const r = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const today = addDays("2026-11-02", int(0, 30));

  const materials: Material[] = Array.from({ length: int(1, 4) }, (_, i) => ({
    id: `M${i}`,
    name: `M${i}`,
    orderUnit: [100, 250, 500, 800, 1500][int(0, 4)]!,
    moq: r() < 0.4 ? int(1, 40) * 100 : null,
    leadTimeBdays: int(0, 20),
    stockQty: int(0, 3000),
  }));
  const bomItems: BomItem[] = [];
  for (let p = 0; p < 3; p++) {
    for (const m of materials) if (r() < 0.7) bomItems.push({ productId: `X${p}`, materialId: m.id, qtyPerUnit: int(1, 20) });
  }
  const projects: Project[] = Array.from({ length: int(1, 8) }, (_, i) => ({
    id: `P${i}`,
    name: `P${i}`,
    productId: `X${int(0, 2)}`,
    productionQty: int(1, 300),
    startDate: addDays(today, int(-5, 90)),
    status: "planned",
  }));
  const holidays = Array.from({ length: int(0, 10) }, () => addDays(today, int(-30, 90)));
  return { today, materials, bomItems, projects, holidays };
}

describe("수용 기준 (무작위 시나리오 500개)", () => {
  const seeds = Array.from({ length: 500 }, (_, i) => i + 1);
  const s = DEFAULT_SETTINGS;

  it.each(seeds)("seed %i", (seed) => {
    const input = randomScenario(seed);
    const { orders } = calculatePlan(input);
    const cal = createCalendar(input.holidays);
    const projectById = new Map(input.projects.map((p) => [p.id, p]));

    for (const m of input.materials) {
      const mine = orders.filter((o) => o.materialId === m.id).sort((a, b) => a.orderDate.localeCompare(b.orderDate));

      for (const o of mine) {
        // AC3: 발주 단위의 배수 / AC4-1: MOQ 이상
        expect(o.orderQty % m.orderUnit).toBe(0);
        expect(o.orderQty).toBeGreaterThan(0);
        if (m.moq !== null) expect(o.orderQty).toBeGreaterThanOrEqual(m.moq);
        // AC4: MOQ가 적용되지 않은 발주의 잔여재고 < 발주 단위
        if (!o.moqApplied) expect(o.remainingAfterQty).toBeLessThan(m.orderUnit);
        // AC5: 발주일·입고일은 영업일
        expect(cal.isBusinessDay(o.orderDate)).toBe(true);
        expect(cal.isBusinessDay(o.expectedArrivalDate)).toBe(true);
        // AC1: 입고일 ≤ 생산시작일 − 여유일
        for (const pid of o.projectIds) {
          const start = cal.previousBusinessDay(projectById.get(pid)!.startDate);
          expect(o.expectedArrivalDate <= cal.subtractBusinessDays(start, s.bufferBdays)).toBe(true);
        }
      }

      // AC6: 남은 발주끼리는 발주일 간격이 합치기 기간보다 길다
      for (let i = 1; i < mine.length; i++) {
        expect(cal.businessDaysBetween(mine[i - 1]!.orderDate, mine[i]!.orderDate)).toBeGreaterThan(s.mergeWindowBdays);
      }

      // AC2: 각 생산시작일 전까지 누적 입고 ≥ 누적 필요수량
      const perUnit = new Map<string, number>();
      for (const b of input.bomItems) if (b.materialId === m.id) perUnit.set(b.productId, (perUnit.get(b.productId) ?? 0) + b.qtyPerUnit);
      const demands = input.projects
        .filter((p) => perUnit.has(p.productId))
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
      let cumulative = 0;
      for (const p of demands) {
        cumulative += p.productionQty * perUnit.get(p.productId)!;
        const supplied = m.stockQty + mine.filter((o) => o.expectedArrivalDate < p.startDate).reduce((sum, o) => sum + o.orderQty, 0);
        expect(supplied).toBeGreaterThanOrEqual(cumulative);
      }
    }
  });
});
