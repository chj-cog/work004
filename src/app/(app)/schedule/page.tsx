import { calculatePlan } from "@/engine";
import { requireUser } from "@/lib/auth";
import { loadPlanData } from "@/lib/data/plan-input";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Todo } from "@/components/placeholder";

export const metadata = { title: "일정 보기" };

/** S2: 생산시작일과 발주일·입고일을 날짜순 한 줄로 늘어놓는다. 간트 차트는 다음 단계 */
export default async function SchedulePage() {
  await requireUser();
  const supabase = await createClient();
  const { input, materials, projects } = await loadPlanData(supabase);
  const { orders } = calculatePlan(input);
  const materialName = new Map(materials.map((m) => [m.id, m.name]));

  const events = [
    ...projects
      .filter((p) => p.status === "planned" || p.status === "in_progress")
      .map((p) => ({ date: p.start_date, kind: "생산시작", text: p.name })),
    ...orders.flatMap((o) => [
      { date: o.orderDate, kind: "발주", text: materialName.get(o.materialId) ?? o.materialId },
      { date: o.expectedArrivalDate, kind: "입고", text: materialName.get(o.materialId) ?? o.materialId },
    ]),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div>
      <PageHeader title="일정 보기" description="생산시작일과 발주·입고 예정일을 날짜순으로 봅니다." />
      <ul className="divide-y divide-slate-100 rounded border border-slate-200 bg-white text-sm">
        {events.map((e, i) => (
          <li key={i} className="flex gap-4 p-2">
            <span className="w-24 shrink-0">{formatDate(e.date)}</span>
            <span className="w-16 shrink-0 font-semibold">{e.kind}</span>
            <span>{e.text}</span>
          </li>
        ))}
      </ul>
      <Todo>날짜축 간트 차트 (프로젝트별 생산시작일, 부자재별 발주일 → 입고일 막대, 휴일 회색 표시)</Todo>
    </div>
  );
}
