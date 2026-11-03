"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { calculatePlan } from "@/engine";
import { requireUser } from "@/lib/auth";
import { loadPlanData } from "@/lib/data/plan-input";
import { createClient } from "@/lib/supabase/server";

/**
 * 발주 완료 체크. 화면에서 받은 값을 믿지 않고 서버에서 다시 계산해 같은 줄을 찾는다.
 * 다른 팀원이 먼저 체크했거나 일정이 바뀌었으면 그 줄이 없으므로 새로고침을 안내한다.
 */
export async function markOrdered(formData: FormData): Promise<void> {
  const user = await requireUser();
  const materialId = String(formData.get("materialId"));
  const orderDate = String(formData.get("orderDate"));

  const supabase = await createClient();
  const { input } = await loadPlanData(supabase);
  const order = calculatePlan(input).orders.find((o) => o.materialId === materialId && o.orderDate === orderDate);
  if (!order) redirect("/?notice=stale");

  const { data: inserted, error } = await supabase
    .from("purchase_orders")
    .insert({
      material_id: order.materialId,
      order_date: order.orderDate,
      order_qty: order.orderQty,
      expected_arrival_date: order.expectedArrivalDate,
      remaining_after_qty: order.remainingAfterQty,
      moq_applied: order.moqApplied,
      ordered_by: user.id,
    })
    .select("id")
    .single();
  if (error || !inserted) throw new Error(`발주 완료를 저장하지 못했습니다: ${error?.message}`);

  const { error: allocError } = await supabase.from("order_allocations").insert(
    order.allocations.map((a) => ({
      order_id: inserted.id,
      project_id: a.projectId,
      required_qty: a.requiredQty,
      from_stock_qty: a.fromStockQty,
      from_order_qty: a.fromOrderQty,
    })),
  );
  if (allocError) {
    await supabase.from("purchase_orders").delete().eq("id", inserted.id);
    throw new Error(`발주 배정을 저장하지 못했습니다: ${allocError.message}`);
  }
  revalidatePath("/");
}

/** 발주 완료를 되돌린다 (잘못 체크했을 때) */
export async function undoOrdered(formData: FormData): Promise<void> {
  await requireUser();
  const supabase = await createClient();
  await supabase.from("purchase_orders").delete().eq("id", String(formData.get("orderId"))).eq("status", "ordered");
  revalidatePath("/");
}

export async function markReceived(formData: FormData): Promise<void> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("receive_order", { p_order_id: String(formData.get("orderId")) });
  if (error) throw new Error(error.message);
  revalidatePath("/");
}
