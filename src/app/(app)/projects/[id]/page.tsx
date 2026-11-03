import { notFound } from "next/navigation";
import { calculatePlan } from "@/engine";
import { requireUser } from "@/lib/auth";
import { loadPlanData } from "@/lib/data/plan-input";
import { formatDate, formatQty } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { DeleteButton } from "@/components/form";
import { PageHeader } from "@/components/placeholder";
import { deleteProject } from "../actions";
import { ProjectForm } from "../project-form";

export const metadata = { title: "프로젝트 수정" };

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: project }, { data: products }, planData] = await Promise.all([
    supabase.from("projects").select("id, name, product_id, production_qty, start_date, status, updated_at").eq("id", id).maybeSingle(),
    supabase.from("products").select("id, name").order("id"),
    loadPlanData(supabase),
  ]);
  if (!project) notFound();

  // 이 프로젝트에 필요한 부자재와, 이 프로젝트가 묶인 계획 발주 (S3 미리보기)
  const { data: bom } = await supabase
    .from("bom_items")
    .select("material_id, qty_per_unit, materials(name, unit)")
    .eq("product_id", project.product_id)
    .returns<{ material_id: string; qty_per_unit: number; materials: { name: string; unit: string } | null }[]>();
  const { orders } = calculatePlan(planData.input);
  const myOrders = orders.filter((o) => o.projectIds.includes(project.id));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <PageHeader title={`프로젝트 수정 · ${project.name}`} />
        <DeleteButton
          action={deleteProject}
          fields={{ id: project.id }}
          confirmText={`${project.name}을(를) 삭제할까요? 일정이 미뤄지거나 없어진 경우에는 삭제 대신 상태를 '취소'로 바꾸는 것을 권장합니다.`}
        />
      </div>
      <ProjectForm
        products={products ?? []}
        initial={{
          id: project.id,
          version: project.updated_at,
          name: project.name,
          product_id: project.product_id,
          production_qty: String(project.production_qty),
          start_date: project.start_date,
          status: project.status,
        }}
      />

      <section className="max-w-xl rounded border border-slate-200 bg-white p-4 text-sm">
        <h2 className="mb-2 font-semibold">필요 부자재 (저장된 값 기준)</h2>
        <table className="w-full">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1">부자재</th>
              <th className="py-1 text-right">필요수량</th>
              <th className="py-1">계획 발주</th>
            </tr>
          </thead>
          <tbody>
            {(bom ?? []).map((b) => {
              const order = myOrders.find((o) => o.materialId === b.material_id);
              return (
                <tr key={b.material_id} className="border-t border-slate-100">
                  <td className="py-1">{b.materials?.name ?? b.material_id}</td>
                  <td className="py-1 text-right">
                    {formatQty(Number(project.production_qty) * Number(b.qty_per_unit))} {b.materials?.unit}
                  </td>
                  <td className="py-1 pl-3">
                    {order ? `${formatDate(order.orderDate)} 발주 ${formatQty(order.orderQty)}` : <span className="text-slate-500">재고·입고 예정으로 충당</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
