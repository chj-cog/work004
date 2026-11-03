import { calculatePlan, type OrderStatus, type PlannedOrder } from "@/engine";
import { requireUser } from "@/lib/auth";
import { loadPlanData } from "@/lib/data/plan-input";
import { formatDate, formatQty } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/print-button";
import { markOrdered, markReceived, undoOrdered } from "./actions";

export const metadata = { title: "발주 체크리스트" };

const STATUS_LABEL: Record<OrderStatus, { text: string; className: string }> = {
  overdue: { text: "지남", className: "bg-red-100 text-red-800" },
  imminent: { text: "임박", className: "bg-orange-100 text-orange-800" },
  scheduled: { text: "예정", className: "bg-slate-100 text-slate-600" },
};

interface OrderedRow {
  id: string;
  material_id: string;
  order_date: string;
  order_qty: number;
  expected_arrival_date: string;
  remaining_after_qty: number;
  ordered_at: string;
  profiles: { name: string; email: string } | null;
  order_allocations: { project_id: string }[];
}

export default async function ChecklistPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  await requireUser();
  const { notice } = await searchParams;
  const supabase = await createClient();
  const { input, materials, projects } = await loadPlanData(supabase);
  const { orders, issues } = calculatePlan(input);

  const { data: ordered } = await supabase
    .from("purchase_orders")
    .select("id, material_id, order_date, order_qty, expected_arrival_date, remaining_after_qty, ordered_at, profiles(name, email), order_allocations(project_id)")
    .eq("status", "ordered")
    .order("expected_arrival_date")
    .returns<OrderedRow[]>();

  const materialById = new Map(materials.map((m) => [m.id, m]));
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const activeProjects = projects.filter((p) => p.status === "planned" || p.status === "in_progress");
  const count = (s: OrderStatus) => orders.filter((o) => o.status === s).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">부자재 발주 체크리스트</h1>
          <p className="text-sm text-slate-500">기준일 {formatDate(input.today)} · 영업일 기준 · 여유일 {input.settings?.bufferBdays}영업일</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="font-semibold text-red-700">지남 {count("overdue")}</span>
          <span className="font-semibold text-orange-700">임박 {count("imminent")}</span>
          <span className="text-slate-600">예정 {count("scheduled")}</span>
          <PrintButton />
        </div>
      </div>

      {notice === "stale" && (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-900 print:hidden">
          다른 팀원이 먼저 처리했거나 일정이 바뀌어 체크리스트가 달라졌습니다. 최신 내용을 확인해 주세요.
        </p>
      )}

      <section className="rounded border border-slate-200 bg-white p-3 text-sm">
        <span className="mr-2 font-semibold">생산일정</span>
        {activeProjects.length === 0
          ? "등록된 프로젝트가 없습니다."
          : activeProjects.map((p) => (
              <span key={p.id} className="mr-4 whitespace-nowrap">
                {p.name} {formatDate(p.start_date)} 시작
              </span>
            ))}
      </section>

      {issues.length > 0 && (
        <ul className="space-y-1 text-sm">
          {issues.map((i, idx) => (
            <li key={idx} className={i.level === "error" ? "text-red-700" : "text-amber-700"}>
              {i.level === "error" ? "오류" : "주의"}: {i.message}
            </li>
          ))}
        </ul>
      )}

      <table className="w-full border-collapse bg-white text-sm">
        <thead>
          <tr className="border-b-2 border-slate-300 text-left">
            <th className="p-2">상태</th>
            <th className="p-2">부자재</th>
            <th className="p-2">사용 프로젝트</th>
            <th className="p-2">발주일</th>
            <th className="p-2 text-right">발주수량</th>
            <th className="p-2">예상 입고일</th>
            <th className="p-2 text-right">발주 후 잔여재고</th>
            <th className="p-2 text-center">발주 완료</th>
          </tr>
        </thead>
        <tbody>
          {orders.length === 0 && (
            <tr>
              <td colSpan={8} className="p-6 text-center text-slate-500">
                발주할 부자재가 없습니다.
              </td>
            </tr>
          )}
          {orders.map((o) => (
            <OrderRow key={`${o.materialId}-${o.orderDate}`} order={o} material={materialById.get(o.materialId)} projectName={projectName} />
          ))}
        </tbody>
      </table>

      {ordered && ordered.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">발주 완료 · 입고 대기</h2>
          <table className="w-full border-collapse bg-white text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left text-slate-500">
                <th className="p-2">부자재</th>
                <th className="p-2">사용 프로젝트</th>
                <th className="p-2 text-right">발주수량</th>
                <th className="p-2">예상 입고일</th>
                <th className="p-2">발주 완료</th>
                <th className="p-2 print:hidden" />
              </tr>
            </thead>
            <tbody>
              {ordered.map((o) => (
                <tr key={o.id} className="border-b border-slate-100">
                  <td className="p-2">{materialById.get(o.material_id)?.name ?? o.material_id}</td>
                  <td className="p-2">{o.order_allocations.map((a) => projectName.get(a.project_id) ?? "?").join(", ")}</td>
                  <td className="p-2 text-right">{formatQty(Number(o.order_qty))}</td>
                  <td className="p-2">{formatDate(o.expected_arrival_date)}</td>
                  <td className="p-2">
                    ✅ {formatDate(o.ordered_at)} · {o.profiles?.name || o.profiles?.email}
                  </td>
                  <td className="space-x-2 p-2 text-right print:hidden">
                    <form action={markReceived} className="inline">
                      <input type="hidden" name="orderId" value={o.id} />
                      <button type="submit" className="rounded bg-emerald-700 px-2 py-1 text-xs text-white">
                        입고 처리
                      </button>
                    </form>
                    <form action={undoOrdered} className="inline">
                      <input type="hidden" name="orderId" value={o.id} />
                      <button type="submit" className="text-xs text-slate-500 underline">
                        체크 취소
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function OrderRow({
  order: o,
  material,
  projectName,
}: {
  order: PlannedOrder;
  material: { name: string; order_unit: number; lead_time_bdays: number } | undefined;
  projectName: Map<string, string>;
}) {
  const status = STATUS_LABEL[o.status];
  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="p-2">
        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${status.className}`}>{status.text}</span>
      </td>
      <td className="p-2">
        <div className="font-medium">{material?.name ?? o.materialId}</div>
        <div className="text-xs text-slate-500">
          단위 {formatQty(Number(material?.order_unit ?? 0))} · LT {material?.lead_time_bdays}영업일
        </div>
      </td>
      <td className="p-2">{o.projectIds.map((id) => projectName.get(id) ?? id).join(", ")}</td>
      <td className="p-2">{formatDate(o.orderDate)}</td>
      <td className="p-2 text-right">
        {formatQty(o.orderQty)}
        {o.moqApplied && <div className="text-xs text-violet-700">MOQ 적용</div>}
      </td>
      <td className="p-2">
        {formatDate(o.expectedArrivalDate)}
        {o.arrivalIfOrderedToday && (
          <div className={`text-xs ${o.delayRisk ? "font-semibold text-red-700" : "text-slate-600"}`}>
            지금 발주 시 {formatDate(o.arrivalIfOrderedToday)}
            {o.delayRisk && " · 생산 지연 위험"}
          </div>
        )}
      </td>
      <td className="p-2 text-right">{formatQty(o.remainingAfterQty)}</td>
      <td className="p-2 text-center">
        <form action={markOrdered} className="print:hidden">
          <input type="hidden" name="materialId" value={o.materialId} />
          <input type="hidden" name="orderDate" value={o.orderDate} />
          <button type="submit" className="rounded border border-slate-400 px-2 py-1 text-xs hover:bg-slate-100">
            ☐ 발주 완료
          </button>
        </form>
        <span className="hidden print:inline">☐</span>
      </td>
    </tr>
  );
}
