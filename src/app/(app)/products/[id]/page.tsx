import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DeleteButton } from "@/components/form";
import { PageHeader } from "@/components/placeholder";
import { deleteBomItem, deleteProduct } from "../actions";
import { AddBomItemForm, BomQtyForm, RenameProductForm } from "../product-forms";

export const metadata = { title: "제품·BOM 수정" };

interface BomRow {
  material_id: string;
  qty_per_unit: number;
  materials: { name: string; unit: string } | null;
}

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const id = decodeURIComponent((await params).id);
  const supabase = await createClient();
  const [{ data: product }, { data: bom }, { data: materials }] = await Promise.all([
    supabase.from("products").select("id, name").eq("id", id).maybeSingle(),
    supabase.from("bom_items").select("material_id, qty_per_unit, materials(name, unit)").eq("product_id", id).order("material_id").returns<BomRow[]>(),
    supabase.from("materials").select("id, name, unit").order("id"),
  ]);
  if (!product) notFound();

  const used = new Set((bom ?? []).map((b) => b.material_id));
  const available = (materials ?? []).filter((m) => !used.has(m.id));

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <PageHeader title={`제품·BOM · ${product.name}`} description={`제품 코드 ${product.id}`} />
        <DeleteButton
          action={deleteProduct}
          fields={{ id: product.id }}
          confirmText={`${product.name}을(를) 삭제할까요? BOM도 함께 삭제됩니다. 이 제품을 만드는 프로젝트가 있으면 삭제되지 않습니다.`}
        />
      </div>

      <section className="rounded border border-slate-200 bg-white p-4">
        <RenameProductForm id={product.id} name={product.name} />
      </section>

      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-semibold">BOM (제품 1개당 소요량)</h2>
        <table className="mb-4 w-full text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left text-slate-500">
              <th className="py-1">부자재</th>
              <th className="py-1 text-right">소요량</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {(bom ?? []).length === 0 && (
              <tr>
                <td colSpan={3} className="py-4 text-center text-slate-500">
                  BOM이 비어 있습니다. 이 제품의 프로젝트는 발주 계산에서 오류로 표시됩니다.
                </td>
              </tr>
            )}
            {(bom ?? []).map((b) => (
              <tr key={b.material_id} className="border-b border-slate-100">
                <td className="py-1.5">
                  {b.materials?.name ?? b.material_id} <span className="text-xs text-slate-500">{b.materials?.unit}</span>
                </td>
                <td className="py-1.5">
                  <BomQtyForm productId={product.id} materialId={b.material_id} qty={Number(b.qty_per_unit)} />
                </td>
                <td className="py-1.5 pl-3 text-right">
                  <DeleteButton
                    action={deleteBomItem}
                    fields={{ product_id: product.id, material_id: b.material_id }}
                    confirmText={`BOM에서 ${b.materials?.name ?? b.material_id}을(를) 뺄까요?`}
                    label="빼기"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <AddBomItemForm productId={product.id} materials={available} />
      </section>

      <Link href="/products" className="text-sm text-slate-600 underline">
        제품 목록으로
      </Link>
    </div>
  );
}
