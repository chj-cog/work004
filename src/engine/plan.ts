import { createCalendar, isValidISODate, yearOf, type BusinessCalendar } from "./calendar";
import {
  DEFAULT_SETTINGS,
  type Allocation,
  type ISODate,
  type Issue,
  type Material,
  type OrderStatus,
  type PlanInput,
  type PlannedOrder,
  type PlanResult,
  type Project,
  type Settings,
} from "./types";

/** 소수 소요량(0.1 등)의 부동소수점 오차를 없앤다 */
const roundQty = (x: number): number => Math.round(x * 1e6) / 1e6;

const roundUpToUnit = (qty: number, unit: number): number => Math.ceil(roundQty(qty / unit)) * unit;

const STATUS_RANK: Record<OrderStatus, number> = { overdue: 0, imminent: 1, scheduled: 2 };

/** 한 부자재에 대한 프로젝트 한 건의 수요 */
interface Demand {
  projectId: string;
  requiredQty: number;
  startDate: ISODate;
  /** 생산시작일이 휴일이면 직전 영업일. 발주일 역산의 기준 */
  effectiveStart: ISODate;
  /** 이 프로젝트만 놓고 보면 발주해야 하는 날 */
  orderDate: ISODate;
}

type DraftOrder = Omit<PlannedOrder, "status" | "arrivalIfOrderedToday" | "delayRisk"> & {
  firstStartDate: ISODate;
};

export function calculatePlan(input: PlanInput): PlanResult {
  if (!isValidISODate(input.today)) throw new Error(`잘못된 기준일: ${input.today}`);
  const settings: Settings = { ...DEFAULT_SETTINGS, ...input.settings };
  const issues: Issue[] = [];

  const validHolidays = input.holidays.filter((h) => isValidISODate(h));
  for (const h of input.holidays) {
    if (!isValidISODate(h)) issues.push({ level: "warning", code: "INVALID_DATE", message: `잘못된 휴일 날짜 무시: ${h}` });
  }
  const cal = createCalendar(validHolidays);

  const projects = validateProjects(input, cal, issues);
  const materials = validateMaterials(input.materials, issues);

  const openQtyByMaterial = new Map<string, number>();
  for (const o of input.openOrders ?? []) {
    openQtyByMaterial.set(o.materialId, (openQtyByMaterial.get(o.materialId) ?? 0) + o.qty);
  }

  const drafts: DraftOrder[] = [];
  for (const material of materials) {
    const demands = collectDemands(material, projects, input, cal, settings);
    if (demands.length === 0) continue;
    const initialPool = material.stockQty + (openQtyByMaterial.get(material.id) ?? 0);
    drafts.push(...planMaterial(material, demands, initialPool, cal, settings));
  }

  const orders = drafts.map((d) => finalize(d, input.today, cal, settings, materials));
  orders.sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      a.orderDate.localeCompare(b.orderDate) ||
      a.materialId.localeCompare(b.materialId),
  );

  if (input.holidayYears) checkHolidayYears(input, projects, orders, issues);

  return { orders, issues };
}

function validateProjects(input: PlanInput, cal: BusinessCalendar, issues: Issue[]): Project[] {
  const productsWithBom = new Set(input.bomItems.map((b) => b.productId));
  const result: Project[] = [];
  for (const p of input.projects) {
    if (p.status !== "planned" && p.status !== "in_progress") continue;
    if (!isValidISODate(p.startDate)) {
      issues.push({ level: "error", code: "INVALID_DATE", projectId: p.id, message: `${p.name}: 생산시작일이 올바르지 않습니다 (${p.startDate})` });
      continue;
    }
    if (!(p.productionQty > 0)) {
      issues.push({ level: "error", code: "INVALID_PRODUCTION_QTY", projectId: p.id, message: `${p.name}: 생산수량은 0보다 커야 합니다` });
      continue;
    }
    if (!productsWithBom.has(p.productId)) {
      issues.push({ level: "error", code: "BOM_MISSING", projectId: p.id, message: `${p.name}: 제품 ${p.productId}의 BOM이 등록되지 않았습니다` });
      continue;
    }
    if (!cal.isBusinessDay(p.startDate)) {
      issues.push({ level: "warning", code: "START_ON_HOLIDAY", projectId: p.id, message: `${p.name}: 생산시작일(${p.startDate})이 휴일입니다. 직전 영업일 기준으로 계산합니다` });
    }
    result.push(p);
  }

  const materialIds = new Set(input.materials.map((m) => m.id));
  for (const b of input.bomItems) {
    if (!materialIds.has(b.materialId)) {
      issues.push({ level: "error", code: "UNKNOWN_MATERIAL", materialId: b.materialId, message: `제품 ${b.productId}의 BOM에 등록되지 않은 부자재 ${b.materialId}가 있습니다` });
    }
  }
  return result;
}

function validateMaterials(materials: Material[], issues: Issue[]): Material[] {
  return materials.filter((m) => {
    const err = (code: Issue["code"], message: string) => {
      issues.push({ level: "error", code, materialId: m.id, message: `${m.name}: ${message}` });
      return false;
    };
    if (!(Number.isFinite(m.orderUnit) && m.orderUnit > 0)) return err("INVALID_ORDER_UNIT", "발주 단위는 0보다 커야 합니다");
    if (!(Number.isInteger(m.leadTimeBdays) && m.leadTimeBdays >= 0)) return err("INVALID_LEAD_TIME", "리드타임은 0 이상의 정수(영업일)여야 합니다");
    if (m.moq !== null && !(Number.isFinite(m.moq) && m.moq >= 0)) return err("INVALID_MOQ", "최소 발주수량은 0 이상이어야 합니다");
    if (!(Number.isFinite(m.stockQty) && m.stockQty >= 0)) return err("INVALID_STOCK", "현재 재고는 0 이상이어야 합니다");
    return true;
  });
}

function collectDemands(
  material: Material,
  projects: Project[],
  input: PlanInput,
  cal: BusinessCalendar,
  settings: Settings,
): Demand[] {
  const perUnitByProduct = new Map<string, number>();
  for (const b of input.bomItems) {
    if (b.materialId !== material.id) continue;
    perUnitByProduct.set(b.productId, (perUnitByProduct.get(b.productId) ?? 0) + b.qtyPerUnit);
  }

  const demands: Demand[] = [];
  for (const p of projects) {
    const perUnit = perUnitByProduct.get(p.productId);
    if (!perUnit) continue;
    const requiredQty = roundQty(p.productionQty * perUnit);
    if (requiredQty <= 0) continue;
    const effectiveStart = cal.previousBusinessDay(p.startDate);
    demands.push({
      projectId: p.id,
      requiredQty,
      startDate: p.startDate,
      effectiveStart,
      orderDate: cal.subtractBusinessDays(effectiveStart, material.leadTimeBdays + settings.bufferBdays),
    });
  }
  return demands.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.projectId.localeCompare(b.projectId));
}

/**
 * 생산시작일이 빠른 프로젝트부터 재고를 배정하고, 부족하면 발주를 만든다.
 * 발주가 생기면 그 발주일부터 합치기 기간 안에 발주일이 드는 프로젝트를 한 발주로 묶고,
 * 묶은 부족수량 합(또는 MOQ)을 발주 단위로 올린다. 남는 수량은 다음 프로젝트로 넘어간다.
 */
function planMaterial(
  material: Material,
  demands: Demand[],
  initialPool: number,
  cal: BusinessCalendar,
  settings: Settings,
): DraftOrder[] {
  const result: DraftOrder[] = [];
  let pool = initialPool;
  let last: DraftOrder | null = null;
  let i = 0;

  while (i < demands.length) {
    const first = demands[i]!;

    if (pool >= first.requiredQty) {
      pool = roundQty(pool - first.requiredQty);
      // 앞 발주의 남은 수량으로 충당되면 그 발주의 사용 프로젝트에 붙인다
      if (last) {
        last.allocations.push({ projectId: first.projectId, requiredQty: first.requiredQty, fromStockQty: 0, fromOrderQty: first.requiredQty });
        last.projectIds.push(first.projectId);
        last.remainingAfterQty = pool;
      }
      i++;
      continue;
    }

    const group: Demand[] = [first];
    let j = i + 1;
    while (j < demands.length && cal.businessDaysBetween(first.orderDate, demands[j]!.orderDate) <= settings.mergeWindowBdays) {
      group.push(demands[j]!);
      j++;
    }

    const groupDemand = roundQty(group.reduce((s, d) => s + d.requiredQty, 0));
    const shortage = roundQty(groupDemand - pool);
    const withoutMoq = roundUpToUnit(shortage, material.orderUnit);
    const orderQty = roundUpToUnit(Math.max(shortage, material.moq ?? 0), material.orderUnit);

    let poolLeft = pool;
    const allocations: Allocation[] = group.map((d) => {
      const fromStockQty = Math.min(poolLeft, d.requiredQty);
      poolLeft = roundQty(poolLeft - fromStockQty);
      return { projectId: d.projectId, requiredQty: d.requiredQty, fromStockQty, fromOrderQty: roundQty(d.requiredQty - fromStockQty) };
    });

    pool = roundQty(pool + orderQty - groupDemand);
    last = {
      materialId: material.id,
      orderDate: first.orderDate,
      orderQty,
      expectedArrivalDate: cal.addBusinessDays(first.orderDate, material.leadTimeBdays),
      remainingAfterQty: pool,
      moqApplied: orderQty > withoutMoq,
      projectIds: group.map((d) => d.projectId),
      allocations,
      firstStartDate: first.startDate,
    };
    result.push(last);
    i = j;
  }
  return result;
}

function finalize(
  draft: DraftOrder,
  today: ISODate,
  cal: BusinessCalendar,
  settings: Settings,
  materials: Material[],
): PlannedOrder {
  const { firstStartDate, ...order } = draft;
  let status: OrderStatus;
  if (order.orderDate < today) status = "overdue";
  else if (cal.businessDaysBetween(today, order.orderDate) <= settings.imminentBdays) status = "imminent";
  else status = "scheduled";

  let arrivalIfOrderedToday: ISODate | null = null;
  let delayRisk = false;
  if (status === "overdue") {
    const leadTime = materials.find((m) => m.id === order.materialId)!.leadTimeBdays;
    arrivalIfOrderedToday = cal.addBusinessDays(today, leadTime);
    // 생산시작일 당일 입고도 늦은 것으로 본다
    delayRisk = arrivalIfOrderedToday >= firstStartDate;
  }
  return { ...order, status, arrivalIfOrderedToday, delayRisk };
}

function checkHolidayYears(input: PlanInput, projects: Project[], orders: PlannedOrder[], issues: Issue[]): void {
  const loaded = new Set(input.holidayYears);
  const used = new Set<number>([yearOf(input.today)]);
  for (const p of projects) used.add(yearOf(p.startDate));
  for (const o of orders) used.add(yearOf(o.orderDate));
  for (const y of [...used].sort()) {
    if (!loaded.has(y)) {
      issues.push({ level: "warning", code: "HOLIDAYS_MISSING", message: `${y}년 공휴일 미수신 — 발주일이 실제보다 늦게 잡힐 수 있습니다` });
    }
  }
}
