import { describe, expect, it } from "vitest";
import { calculatePlan, DEFAULT_SETTINGS, type PlanInput } from "@/engine";
import { extractByRules } from "./extract-rules";
import fixture from "./fixtures/rules-cases.json";
import { parseNumber } from "./korean-numbers";
import { applyToPlanInput, buildContext, buildItems, diffOrders, validateRecords, type IntakeItems } from "./types";

const items = fixture.items as IntakeItems;

describe("한글 숫자", () => {
  it.each([
    ["천이백", 1200], ["백오십", 150], ["이십사", 24], ["만", 10000], ["만이천", 12000], ["영", 0],
    ["한", 1], ["열두", 12], ["스무", 20], ["스물다섯", 25], ["1,200", 1200], ["2.5", 2.5],
  ])("%s → %d", (text, expected) => expect(parseNumber(text)).toBe(expected));

  it.each(["이삼", "십백", "", "박스"])("%s 는 숫자가 아니다", (text) => expect(parseNumber(text)).toBeNull());
});

describe("규칙 기반 정리 — 파이썬 구현(poc)과 같은 답", () => {
  // 사례는 poc/tools/rules_fixture.py 가 파이썬 구현을 돌려서 만든다
  it.each(fixture.cases.map((c) => [c.text, c] as const))("%s", (_text, c) => {
    expect(extractByRules(c.text, items, fixture.context)).toEqual({ records: c.records, needsReview: c.needsReview, reasons: c.reasons });
  });

  it("사례가 충분히 들어 있다", () => expect(fixture.cases.length).toBeGreaterThan(200));
});

describe("DB 값에서 품목 목록 만들기", () => {
  const built = buildItems(
    [{ id: "A", name: "나사", unit: "개", aliases: ["스크류", " 나사 "], packs: [{ unit: "박스", qty: 800 }, { unit: "", qty: 1 }, { unit: "봉", qty: 0 }] }],
    [
      { id: "p1", name: "가 프로젝트", aliases: ["피원"], start_date: "2026-11-20", status: "planned" },
      { id: "p2", name: "끝난 것", aliases: null, start_date: "2026-10-01", status: "done" },
    ],
  );

  it("이름을 호칭에 넣고, 잘못된 포장 단위와 끝난 프로젝트를 뺀다", () => {
    expect(built.materials[0]).toEqual({ id: "A", name: "나사", aliases: ["나사", "스크류"], baseUnits: ["개"], packs: [{ unit: "박스", qty: 800 }] });
    expect(built.projects).toEqual([{ id: "p1", name: "가 프로젝트", aliases: ["가 프로젝트", "피원"] }]);
  });

  it("그 목록으로 정리한다", () => {
    const context = buildContext("2026-11-03", [{ id: "p1", name: "가 프로젝트", aliases: [], start_date: "2026-11-20", status: "planned" }]);
    expect(extractByRules("스크류 두 박스 반 있고 피원 건 일주일 미뤄졌어요", built, context)).toEqual({
      records: [{ kind: "stock_report", materialId: "A", qty: 2000 }, { kind: "schedule_change", projectId: "p1", startDate: "2026-11-27" }],
      needsReview: false,
      reasons: [],
    });
  });
});

describe("레코드 검사", () => {
  it("올바른 값은 그대로 통과한다", () => {
    const { records, errors } = validateRecords(
      [{ kind: "stock_report", materialId: "A", qty: "2000" }, { kind: "schedule_change", projectId: "P1", startDate: "2026-11-24", productionQty: "" }],
      items,
    );
    expect(errors).toEqual([]);
    expect(records).toEqual([{ kind: "stock_report", materialId: "A", qty: 2000 }, { kind: "schedule_change", projectId: "P1", startDate: "2026-11-24" }]);
  });

  it.each([
    [[{ kind: "stock_report", materialId: "Z", qty: 1 }], "부자재를 선택"],
    [[{ kind: "stock_report", materialId: "A", qty: -1 }], "0 이상"],
    [[{ kind: "stock_report", materialId: "A", qty: "" }], "0 이상"],
    [[{ kind: "stock_report", materialId: "A", qty: 1 }, { kind: "stock_report", materialId: "A", qty: 2 }], "두 번"],
    [[{ kind: "schedule_change", projectId: "P9", startDate: "2026-11-24" }], "프로젝트를 선택"],
    [[{ kind: "schedule_change", projectId: "P1" }], "생산시작일이나 생산수량"],
    [[{ kind: "schedule_change", projectId: "P1", startDate: "11/24" }], "생산시작일이 올바르지"],
    [[{ kind: "schedule_change", projectId: "P1", productionQty: 0 }], "0보다 큰"],
    [[{ kind: "delete_everything" }], "종류를 선택"],
    ["아무 글", "형식"],
  ])("잘못된 값 %#", (value, message) => {
    expect(validateRecords(value, items).errors.join(" ")).toContain(message);
  });
});

describe("미리보기", () => {
  const input: PlanInput = {
    today: "2026-11-03",
    materials: [{ id: "A", name: "나사", orderUnit: 800, moq: null, leadTimeBdays: 6, stockQty: 500 }],
    bomItems: [{ productId: "X", materialId: "A", qtyPerUnit: 13 }],
    projects: [{ id: "P1", name: "P1", productId: "X", productionQty: 100, startDate: "2026-11-20", status: "planned" }],
    openOrders: [],
    holidays: [],
    holidayYears: [2026],
    settings: DEFAULT_SETTINGS,
  };

  it("반영 전후의 발주 차이를 보여 준다. 원래 입력은 바꾸지 않는다", () => {
    const after = applyToPlanInput(input, [{ kind: "stock_report", materialId: "A", qty: 2000 }, { kind: "schedule_change", projectId: "P1", productionQty: 200 }]);
    expect(input.materials[0]?.stockQty).toBe(500);
    expect(after.materials[0]?.stockQty).toBe(2000);
    expect(after.projects[0]).toMatchObject({ productionQty: 200, startDate: "2026-11-20" });

    // 재고가 2,000이면 생산수량 200(필요 2,600)에 600이 모자라 800을 발주한다. 반영 전에는 100개 생산에 800이 모자라 800 발주
    const stockOnly = applyToPlanInput(input, [{ kind: "stock_report", materialId: "A", qty: 2000 }]);
    expect(diffOrders(calculatePlan(input).orders, calculatePlan(stockOnly).orders)).toEqual([
      { materialId: "A", change: "removed", before: [{ orderDate: expect.any(String), orderQty: 800 }], after: [] },
    ]);
  });

  it("달라지지 않으면 빈 목록", () => {
    const { orders } = calculatePlan(input);
    expect(diffOrders(orders, orders)).toEqual([]);
  });
});
