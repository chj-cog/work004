/** 받은 내용(말·글)을 정리한 결과와, 정리에 쓰는 품목 목록 */
import type { PlanInput } from "@/engine";

export interface Pack {
  /** 포장 단위 이름: 박스, 롤, 묶음 … */
  unit: string;
  /** 포장 단위 하나에 낱개가 몇 개인지 */
  qty: number;
}

export interface IntakeMaterial {
  id: string;
  name: string;
  /** 이름을 포함해, 이 부자재를 부르는 모든 이름 */
  aliases: string[];
  /** 낱개를 세는 단위: 개, 장 … */
  baseUnits: string[];
  packs: Pack[];
}

export interface IntakeProject {
  id: string;
  name: string;
  aliases: string[];
}

export interface IntakeItems {
  materials: IntakeMaterial[];
  projects: IntakeProject[];
}

export interface IntakeContext {
  /** 오늘 (YYYY-MM-DD). "다음 주 화요일"을 날짜로 바꿀 때 쓴다 */
  today: string;
  /** 프로젝트별 지금 생산시작일. "일주일 미뤄졌어요"를 계산할 때 쓴다 */
  projectStarts: Record<string, string>;
}

export type IntakeRecord =
  | { kind: "stock_report"; materialId: string; qty: number }
  | { kind: "schedule_change"; projectId: string; startDate?: string; productionQty?: number };

export interface Extraction {
  records: IntakeRecord[];
  needsReview: boolean;
  reasons: string[];
}

export interface MaterialSource {
  id: string;
  name: string;
  unit: string;
  aliases: string[] | null;
  packs: unknown;
}

export interface ProjectSource {
  id: string;
  name: string;
  aliases: string[] | null;
  start_date: string;
  status: string;
}

const unique = (values: string[]) => [...new Set(values.map((v) => v.trim()).filter(Boolean))];

export function parsePacks(value: unknown): Pack[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((p) => {
    const unit = typeof p?.unit === "string" ? p.unit.trim() : "";
    const qty = Number(p?.qty);
    return unit && Number.isFinite(qty) && qty > 0 ? [{ unit, qty }] : [];
  });
}

/** DB의 부자재·프로젝트에서 정리에 쓰는 목록을 만든다. 끝난 프로젝트는 뺀다 */
export function buildItems(materials: MaterialSource[], projects: ProjectSource[]): IntakeItems {
  return {
    materials: materials.map((m) => ({
      id: m.id,
      name: m.name,
      aliases: unique([m.name, ...(m.aliases ?? [])]),
      baseUnits: unique([m.unit, "개"]),
      packs: parsePacks(m.packs),
    })),
    projects: projects
      .filter((p) => p.status === "planned" || p.status === "in_progress")
      .map((p) => ({ id: p.id, name: p.name, aliases: unique([p.name, ...(p.aliases ?? [])]) })),
  };
}

export function buildContext(today: string, projects: ProjectSource[]): IntakeContext {
  return { today, projectStarts: Object.fromEntries(projects.map((p) => [p.id, p.start_date])) };
}

const isIsoDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/**
 * 밖에서 온 레코드(PC 도우미의 LLM 결과, 화면에서 고친 값)를 검사한다.
 * 목록에 없는 품목이나 잘못된 값이 하나라도 있으면 오류 문구를 돌려준다.
 */
export function validateRecords(value: unknown, items: IntakeItems): { records: IntakeRecord[]; errors: string[] } {
  const errors: string[] = [];
  const records: IntakeRecord[] = [];
  if (!Array.isArray(value)) return { records, errors: ["정리 결과의 형식이 맞지 않습니다."] };
  const materials = new Map(items.materials.map((m) => [m.id, m]));
  const projects = new Map(items.projects.map((p) => [p.id, p]));
  const seen = new Set<string>();

  value.forEach((raw, i) => {
    const n = i + 1;
    const r = (raw ?? {}) as Record<string, unknown>;
    if (r.kind === "stock_report") {
      const material = materials.get(String(r.materialId));
      const qty = Number(r.qty);
      if (!material) return void errors.push(`${n}번째: 부자재를 선택하세요.`);
      if (r.qty === "" || r.qty === null || !Number.isFinite(qty) || qty < 0) return void errors.push(`${n}번째: 재고 수량은 0 이상의 숫자여야 합니다.`);
      if (seen.has(`m:${material.id}`)) return void errors.push(`${n}번째: ${material.name}이(가) 두 번 들어 있습니다.`);
      seen.add(`m:${material.id}`);
      records.push({ kind: "stock_report", materialId: material.id, qty });
    } else if (r.kind === "schedule_change") {
      const project = projects.get(String(r.projectId));
      if (!project) return void errors.push(`${n}번째: 프로젝트를 선택하세요.`);
      if (seen.has(`p:${project.id}`)) return void errors.push(`${n}번째: ${project.name}이(가) 두 번 들어 있습니다.`);
      const record: IntakeRecord = { kind: "schedule_change", projectId: project.id };
      if (r.startDate !== undefined && r.startDate !== null && r.startDate !== "") {
        if (!isIsoDate(r.startDate)) return void errors.push(`${n}번째: 생산시작일이 올바르지 않습니다.`);
        record.startDate = r.startDate;
      }
      if (r.productionQty !== undefined && r.productionQty !== null && r.productionQty !== "") {
        const qty = Number(r.productionQty);
        if (!Number.isFinite(qty) || qty <= 0) return void errors.push(`${n}번째: 생산수량은 0보다 큰 숫자여야 합니다.`);
        record.productionQty = qty;
      }
      if (record.startDate === undefined && record.productionQty === undefined) {
        return void errors.push(`${n}번째: 바꿀 생산시작일이나 생산수량을 넣으세요.`);
      }
      seen.add(`p:${project.id}`);
      records.push(record);
    } else {
      errors.push(`${n}번째: 종류를 선택하세요.`);
    }
  });
  return { records, errors };
}

/** 레코드를 반영한 계산 입력을 만든다 (미리보기용. DB는 바꾸지 않는다) */
export function applyToPlanInput(input: PlanInput, records: IntakeRecord[]): PlanInput {
  const stock = new Map<string, number>();
  const schedule = new Map<string, { startDate?: string; productionQty?: number }>();
  for (const r of records) {
    if (r.kind === "stock_report") stock.set(r.materialId, r.qty);
    else schedule.set(r.projectId, r);
  }
  return {
    ...input,
    materials: input.materials.map((m) => (stock.has(m.id) ? { ...m, stockQty: stock.get(m.id)! } : m)),
    projects: input.projects.map((p) => {
      const change = schedule.get(p.id);
      return change ? { ...p, startDate: change.startDate ?? p.startDate, productionQty: change.productionQty ?? p.productionQty } : p;
    }),
  };
}

export interface OrderChange {
  materialId: string;
  change: "new" | "removed" | "changed";
  before: { orderDate: string; orderQty: number }[];
  after: { orderDate: string; orderQty: number }[];
}

/** 부자재별로 발주(발주일, 발주수량)가 어떻게 달라졌는지. 달라진 부자재만 */
export function diffOrders(
  before: { materialId: string; orderDate: string; orderQty: number }[],
  after: { materialId: string; orderDate: string; orderQty: number }[],
): OrderChange[] {
  const group = (orders: typeof before) => {
    const map = new Map<string, { orderDate: string; orderQty: number }[]>();
    for (const o of [...orders].sort((a, b) => a.orderDate.localeCompare(b.orderDate))) {
      map.set(o.materialId, [...(map.get(o.materialId) ?? []), { orderDate: o.orderDate, orderQty: o.orderQty }]);
    }
    return map;
  };
  const b = group(before);
  const a = group(after);
  const changes: OrderChange[] = [];
  for (const materialId of [...new Set([...b.keys(), ...a.keys()])].sort()) {
    const old = b.get(materialId) ?? [];
    const now = a.get(materialId) ?? [];
    if (JSON.stringify(old) === JSON.stringify(now)) continue;
    changes.push({ materialId, change: old.length === 0 ? "new" : now.length === 0 ? "removed" : "changed", before: old, after: now });
  }
  return changes;
}
