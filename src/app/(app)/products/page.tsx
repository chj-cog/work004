import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/placeholder";
import { NewProductForm } from "./product-forms";

export const metadata = { title: "제품·BOM" };

interface ProductRow {
  id: string;
  name: string;
  bom_items: { material_id: string; qty_per_unit: number; materials: { name: string; unit: string } | null }[];
}

export default async function ProductsPage() {
  await requireUser();
  const supabase = await createClient();
  const { data: products } = await supabase
    .from("products")
    .select("id, name, bom_items(material_id, qty_per_unit, materials(name, unit))")
    .order("id")
    .returns<ProductRow[]>();

  return (
    <div className="space-y-4">
      <PageHeader title="제품·BOM" description="제품 1개당 부자재 소요량. 제품을 누르면 BOM을 고칩니다." />
      <NewProductForm />
      <div className="grid gap-4 md:grid-cols-2">
        {(products ?? []).map((p) => (
          <Link key={p.id} href={`/products/${encodeURIComponent(p.id)}`} className="block rounded border border-slate-200 bg-white p-3 hover:border-slate-400">
            <h2 className="mb-2 font-semibold">
              {p.name} <span className="text-sm font-normal text-slate-500">{p.id}</span>
            </h2>
            {p.bom_items.length === 0 ? (
              <p className="text-sm text-amber-700">BOM 미등록</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {p.bom_items.map((b) => (
                    <tr key={b.material_id} className="border-t border-slate-100">
                      <td className="py-1">{b.materials?.name ?? b.material_id}</td>
                      <td className="py-1 text-right">
                        {Number(b.qty_per_unit)} {b.materials?.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Link>
        ))}
      </div>
      <p className="text-sm text-slate-600">
        BOM을 한 번에 넣으려면{" "}
        <Link href="/import?kind=bom" className="underline">
          엑셀 가져오기
        </Link>
        를 쓰세요.
      </p>
    </div>
  );
}
