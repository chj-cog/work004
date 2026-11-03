import { describe, expect, it } from "vitest";
import { calculatePlan } from "./plan";
import type { BomItem, Material, PlanInput, Project } from "./types";

const TODAY = "2026-11-03"; // 화

const material = (m: Partial<Material> & Pick<Material, "id" | "orderUnit" | "leadTimeBdays">): Material => ({
  name: m.id,
  moq: null,
  stockQty: 0,
  ...m,
});

const project = (p: Partial<Project> & Pick<Project, "id" | "productId" | "productionQty" | "startDate">): Project => ({
  name: p.id,
  status: "planned",
  ...p,
});

/** PRD §4.1 체크리스트 예시 */
function prdExample(): PlanInput {
  const bomItems: BomItem[] = [
    { productId: "X", materialId: "A", qtyPerUnit: 17 },
    { productId: "X", materialId: "B", qtyPerUnit: 13 },
    { productId: "X", materialId: "C", qtyPerUnit: 15 },
    { productId: "Y", materialId: "A", qtyPerUnit: 9 },
    { productId: "Y", materialId: "C", qtyPerUnit: 11 },
  ];
  return {
    today: TODAY,
    materials: [
      material({ id: "A", orderUnit: 800, leadTimeBdays: 6, stockQty: 500 }),
      material({ id: "B", orderUnit: 1500, leadTimeBdays: 11 }),
      material({ id: "C", orderUnit: 1000, leadTimeBdays: 8 }),
    ],
    bomItems,
    projects: [
      project({ id: "P1", productId: "X", productionQty: 100, startDate: "2026-11-20" }),
      project({ id: "P2", productId: "Y", productionQty: 100, startDate: "2026-11-24" }),
    ],
    holidays: [],
  };
}

describe("PRD 예시", () => {
  it("§4.1 체크리스트: 지남 → 임박 → 예정 순서와 각 줄의 값", () => {
    const { orders, issues } = calculatePlan(prdExample());
    expect(issues).toEqual([]);
    expect(orders.map((o) => [o.materialId, o.status])).toEqual([
      ["B", "overdue"],
      ["C", "imminent"],
      ["A", "scheduled"],
    ]);

    const [b, c, a] = orders;
    expect(b).toMatchObject({
      orderDate: "2026-11-02",
      orderQty: 1500,
      expectedArrivalDate: "2026-11-17",
      remainingAfterQty: 200,
      projectIds: ["P1"],
      arrivalIfOrderedToday: "2026-11-18",
      delayRisk: false,
    });
    expect(c).toMatchObject({
      orderDate: "2026-11-05",
      orderQty: 3000,
      expectedArrivalDate: "2026-11-17",
      remainingAfterQty: 400,
      projectIds: ["P1", "P2"],
      arrivalIfOrderedToday: null,
    });
    expect(a).toMatchObject({
      orderDate: "2026-11-09",
      orderQty: 2400,
      expectedArrivalDate: "2026-11-17",
      remainingAfterQty: 300,
      projectIds: ["P1", "P2"],
      moqApplied: false,
    });
  });

  it("§6.4 부자재 A: 발주일 간격 2영업일이라 한 발주로 합친다", () => {
    const { orders } = calculatePlan(prdExample());
    const a = orders.find((o) => o.materialId === "A")!;
    expect(a.allocations).toEqual([
      { projectId: "P1", requiredQty: 1700, fromStockQty: 500, fromOrderQty: 1200 },
      { projectId: "P2", requiredQty: 900, fromStockQty: 0, fromOrderQty: 900 },
    ]);
  });

  it("§6.5 부자재 D: MOQ 초과분이 뒤 프로젝트를 덮으면 발주는 한 줄", () => {
    const { orders } = calculatePlan({
      today: TODAY,
      materials: [material({ id: "D", orderUnit: 500, moq: 2000, leadTimeBdays: 6 })],
      bomItems: [
        { productId: "Z", materialId: "D", qtyPerUnit: 7 },
        { productId: "W", materialId: "D", qtyPerUnit: 10 },
      ],
      projects: [
        project({ id: "P1", productId: "Z", productionQty: 100, startDate: "2026-11-20" }),
        project({ id: "P3", productId: "W", productionQty: 100, startDate: "2026-12-15" }),
      ],
      holidays: [],
    });
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      orderDate: "2026-11-09",
      orderQty: 2000,
      moqApplied: true,
      projectIds: ["P1", "P3"],
      remainingAfterQty: 300,
    });
  });
});

describe("발주 계산", () => {
  it("발주일 간격이 5영업일을 넘으면 따로 발주하고, 올림분은 다음 프로젝트에 먼저 배정한다", () => {
    const input = prdExample();
    input.projects[1]!.startDate = "2026-12-01";
    const a = calculatePlan(input).orders.filter((o) => o.materialId === "A");
    expect(a.map((o) => [o.orderDate, o.orderQty, o.remainingAfterQty])).toEqual([
      ["2026-11-09", 1600, 400],
      ["2026-11-18", 800, 300],
    ]);
    expect(a[1]!.allocations[0]).toEqual({ projectId: "P2", requiredQty: 900, fromStockQty: 400, fromOrderQty: 500 });
  });

  it("합치기 기간을 설정으로 바꿀 수 있다", () => {
    const input = { ...prdExample(), settings: { mergeWindowBdays: 1 } };
    const a = calculatePlan(input).orders.filter((o) => o.materialId === "A");
    expect(a.map((o) => o.orderQty)).toEqual([1600, 800]);
  });

  it("휴일을 건너뛰어 발주일을 앞당긴다", () => {
    const input = { ...prdExample(), holidays: ["2026-11-12", "2026-11-13"] };
    const a = calculatePlan(input).orders.find((o) => o.materialId === "A")!;
    expect(a.orderDate).toBe("2026-11-05");
    expect(a.expectedArrivalDate).toBe("2026-11-17");
  });

  it("지금 발주해도 생산시작일까지 못 받으면 생산 지연 위험", () => {
    const input = prdExample();
    input.materials[1]!.leadTimeBdays = 14;
    const b = calculatePlan(input).orders.find((o) => o.materialId === "B")!;
    expect(b).toMatchObject({
      status: "overdue",
      orderDate: "2026-10-28",
      arrivalIfOrderedToday: "2026-11-23",
      delayRisk: true,
    });
  });

  it("발주 완료(미입고) 수량은 입고 예정 재고로 쓴다", () => {
    const input = { ...prdExample(), openOrders: [{ materialId: "A", qty: 1200 }] };
    const a = calculatePlan(input).orders.filter((o) => o.materialId === "A");
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ projectIds: ["P2"], orderDate: "2026-11-11", orderQty: 1600, remainingAfterQty: 700 });
    expect(a[0]!.allocations[0]).toMatchObject({ fromStockQty: 0, fromOrderQty: 900 });
  });

  it("재고만으로 충분하면 발주 줄이 없다", () => {
    const input = prdExample();
    input.materials[0]!.stockQty = 2600;
    expect(calculatePlan(input).orders.some((o) => o.materialId === "A")).toBe(false);
  });

  it("소수 소요량의 부동소수점 오차로 발주 단위를 하나 더 올리지 않는다", () => {
    const { orders } = calculatePlan({
      today: TODAY,
      materials: [material({ id: "T", orderUnit: 100, leadTimeBdays: 2 })],
      bomItems: [{ productId: "X", materialId: "T", qtyPerUnit: 0.1 }],
      projects: [project({ id: "P1", productId: "X", productionQty: 1000, startDate: "2026-11-20" })],
      holidays: [],
    });
    expect(orders[0]!.orderQty).toBe(100);
    expect(orders[0]!.remainingAfterQty).toBe(0);
  });

  it("MOQ가 발주 단위의 배수가 아니면 단위로 올린다", () => {
    const { orders } = calculatePlan({
      today: TODAY,
      materials: [material({ id: "D", orderUnit: 500, moq: 1800, leadTimeBdays: 2 })],
      bomItems: [{ productId: "X", materialId: "D", qtyPerUnit: 1 }],
      projects: [project({ id: "P1", productId: "X", productionQty: 300, startDate: "2026-11-20" })],
      holidays: [],
    });
    expect(orders[0]).toMatchObject({ orderQty: 2000, moqApplied: true });
  });

  it("MOQ보다 부족수량이 크면 MOQ 적용 표시를 하지 않는다", () => {
    const { orders } = calculatePlan({
      today: TODAY,
      materials: [material({ id: "D", orderUnit: 500, moq: 1000, leadTimeBdays: 2 })],
      bomItems: [{ productId: "X", materialId: "D", qtyPerUnit: 1 }],
      projects: [project({ id: "P1", productId: "X", productionQty: 1800, startDate: "2026-11-20" })],
      holidays: [],
    });
    expect(orders[0]).toMatchObject({ orderQty: 2000, moqApplied: false });
  });

  it("완료·취소된 프로젝트는 계산에서 뺀다", () => {
    const input = prdExample();
    input.projects[1]!.status = "cancelled";
    const a = calculatePlan(input).orders.find((o) => o.materialId === "A")!;
    expect(a).toMatchObject({ projectIds: ["P1"], orderQty: 1600 });
  });

  it("생산시작일이 휴일이면 경고하고 직전 영업일 기준으로 역산한다", () => {
    const input = prdExample();
    input.projects[0]!.startDate = "2026-11-21"; // 토
    const { orders, issues } = calculatePlan(input);
    expect(issues).toEqual([expect.objectContaining({ code: "START_ON_HOLIDAY", projectId: "P1" })]);
    expect(orders.find((o) => o.materialId === "A")!.expectedArrivalDate).toBe("2026-11-17");
  });
});

describe("입력 오류", () => {
  it("BOM이 없는 제품의 프로젝트는 오류로 알리고 뺀다", () => {
    const input = prdExample();
    input.projects.push(project({ id: "P9", productId: "NONE", productionQty: 10, startDate: "2026-11-20" }));
    const { issues } = calculatePlan(input);
    expect(issues).toEqual([expect.objectContaining({ level: "error", code: "BOM_MISSING", projectId: "P9" })]);
  });

  it("발주 단위가 0인 부자재는 오류로 알리고 발주를 만들지 않는다", () => {
    const input = prdExample();
    input.materials[0]!.orderUnit = 0;
    const { orders, issues } = calculatePlan(input);
    expect(issues).toEqual([expect.objectContaining({ code: "INVALID_ORDER_UNIT", materialId: "A" })]);
    expect(orders.some((o) => o.materialId === "A")).toBe(false);
  });

  it("BOM에 등록되지 않은 부자재가 있으면 오류", () => {
    const input = prdExample();
    input.bomItems.push({ productId: "X", materialId: "GHOST", qtyPerUnit: 1 });
    expect(calculatePlan(input).issues).toEqual([expect.objectContaining({ code: "UNKNOWN_MATERIAL", materialId: "GHOST" })]);
  });

  it("공휴일을 받지 않은 연도가 계산에 쓰이면 경고", () => {
    const input = { ...prdExample(), holidayYears: [2026] };
    input.projects[1]!.startDate = "2027-01-05";
    const { issues } = calculatePlan(input);
    expect(issues).toEqual([expect.objectContaining({ code: "HOLIDAYS_MISSING", message: expect.stringContaining("2027") })]);
  });
});
