import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Material, PlanInput, Project, Settings } from "@/engine";
import { todayInSeoul } from "@/lib/dates";

export interface MaterialRow {
  id: string;
  name: string;
  unit: string;
  order_unit: number;
  moq: number | null;
  lead_time_bdays: number;
  stock_qty: number;
}

export interface ProjectRow {
  id: string;
  name: string;
  product_id: string;
  production_qty: number;
  start_date: string;
  status: Project["status"];
}

export interface PlanData {
  input: PlanInput;
  materials: MaterialRow[];
  projects: ProjectRow[];
  settings: Settings;
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}을(를) 불러오지 못했습니다: ${result.error.message}`);
  return result.data as T;
}

/** DB에서 계산 엔진 입력을 만든다 */
export async function loadPlanData(supabase: SupabaseClient): Promise<PlanData> {
  const [materialsRes, bomRes, projectsRes, openRes, holidaysRes, settingsRes] = await Promise.all([
    supabase.from("materials").select("id, name, unit, order_unit, moq, lead_time_bdays, stock_qty").order("id"),
    supabase.from("bom_items").select("product_id, material_id, qty_per_unit"),
    supabase.from("projects").select("id, name, product_id, production_qty, start_date, status").order("start_date"),
    supabase.from("purchase_orders").select("material_id, order_qty").eq("status", "ordered"),
    supabase.from("holidays").select("date, source"),
    supabase.from("settings").select("buffer_bdays, imminent_bdays, merge_window_bdays").single(),
  ]);

  const materials = unwrap<MaterialRow[]>(materialsRes, "부자재");
  const bom = unwrap<{ product_id: string; material_id: string; qty_per_unit: number }[]>(bomRes, "BOM");
  const projects = unwrap<ProjectRow[]>(projectsRes, "프로젝트");
  const open = unwrap<{ material_id: string; order_qty: number }[]>(openRes, "발주");
  const holidays = unwrap<{ date: string; source: string }[]>(holidaysRes, "휴일");
  const s = unwrap<{ buffer_bdays: number; imminent_bdays: number; merge_window_bdays: number }>(settingsRes, "설정");

  const settings: Settings = { bufferBdays: s.buffer_bdays, imminentBdays: s.imminent_bdays, mergeWindowBdays: s.merge_window_bdays };
  const engineMaterials: Material[] = materials.map((m) => ({
    id: m.id,
    name: m.name,
    orderUnit: Number(m.order_unit),
    moq: m.moq === null ? null : Number(m.moq),
    leadTimeBdays: m.lead_time_bdays,
    stockQty: Number(m.stock_qty),
  }));

  return {
    materials,
    projects,
    settings,
    input: {
      today: todayInSeoul(),
      materials: engineMaterials,
      bomItems: bom.map((b) => ({ productId: b.product_id, materialId: b.material_id, qtyPerUnit: Number(b.qty_per_unit) })),
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        productId: p.product_id,
        productionQty: Number(p.production_qty),
        startDate: p.start_date,
        status: p.status,
      })),
      openOrders: open.map((o) => ({ materialId: o.material_id, qty: Number(o.order_qty) })),
      holidays: holidays.map((h) => h.date),
      // API로 공휴일을 받은 연도만 "받은 연도"로 본다
      holidayYears: [...new Set(holidays.filter((h) => h.source === "api").map((h) => Number(h.date.slice(0, 4))))],
      settings,
    },
  };
}
