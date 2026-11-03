import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DeleteButton } from "@/components/form";
import { PageHeader } from "@/components/placeholder";
import { deleteMaterial } from "../actions";
import { MaterialForm } from "../material-form";

export const metadata = { title: "부자재 수정" };

export default async function EditMaterialPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const id = decodeURIComponent((await params).id);
  const supabase = await createClient();
  const { data: m } = await supabase
    .from("materials")
    .select("id, name, unit, order_unit, moq, lead_time_bdays, stock_qty, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!m) notFound();

  return (
    <div>
      <div className="flex items-start justify-between">
        <PageHeader title={`부자재 수정 · ${m.name}`} />
        <DeleteButton
          action={deleteMaterial}
          fields={{ id: m.id }}
          confirmText={`${m.name}을(를) 삭제할까요? BOM이나 발주 기록에서 쓰고 있으면 삭제되지 않습니다.`}
        />
      </div>
      <MaterialForm
        mode="edit"
        initial={{
          version: m.updated_at,
          id: m.id,
          name: m.name,
          unit: m.unit,
          order_unit: String(m.order_unit),
          moq: m.moq === null ? "" : String(m.moq),
          lead_time_bdays: String(m.lead_time_bdays),
          stock_qty: String(m.stock_qty),
        }}
      />
    </div>
  );
}
