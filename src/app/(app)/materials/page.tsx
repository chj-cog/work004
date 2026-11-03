import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { formatQty } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/placeholder";

export const metadata = { title: "부자재" };

export default async function MaterialsPage() {
  await requireUser();
  const supabase = await createClient();
  const [{ data: materials }, { data: open }] = await Promise.all([
    supabase.from("materials").select("id, name, unit, order_unit, moq, lead_time_bdays, stock_qty").order("id"),
    supabase.from("purchase_orders").select("material_id, order_qty").eq("status", "ordered"),
  ]);
  const incoming = new Map<string, number>();
  for (const o of open ?? []) incoming.set(o.material_id, (incoming.get(o.material_id) ?? 0) + Number(o.order_qty));

  return (
    <div>
      <div className="flex items-start justify-between">
        <PageHeader title="부자재" description="발주 단위, 최소 발주수량(MOQ), 리드타임(영업일), 재고" />
        <Link href="/materials/new" className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
          부자재 추가
        </Link>
      </div>
      <table className="w-full bg-white text-sm">
        <thead>
          <tr className="border-b-2 border-slate-300 text-left">
            <th className="p-2">코드</th>
            <th className="p-2">이름</th>
            <th className="p-2 text-right">발주 단위</th>
            <th className="p-2 text-right">MOQ</th>
            <th className="p-2 text-right">리드타임</th>
            <th className="p-2 text-right">현재 재고</th>
            <th className="p-2 text-right">입고 예정</th>
          </tr>
        </thead>
        <tbody>
          {(materials ?? []).map((m) => {
            const unit = Number(m.order_unit);
            const moq = m.moq === null ? null : Number(m.moq);
            const effectiveMoq = moq === null ? null : Math.ceil(moq / unit) * unit;
            return (
              <tr key={m.id} className="border-b border-slate-100">
                <td className="p-2">{m.id}</td>
                <td className="p-2">
                  <Link href={`/materials/${encodeURIComponent(m.id)}`} className="font-medium underline-offset-2 hover:underline">
                    {m.name}
                  </Link>
                </td>
                <td className="p-2 text-right">{formatQty(unit)}</td>
                <td className="p-2 text-right">
                  {moq === null ? "—" : formatQty(moq)}
                  {effectiveMoq !== null && effectiveMoq !== moq && (
                    <div className="text-xs text-slate-500">실제 최소 발주 {formatQty(effectiveMoq)}</div>
                  )}
                </td>
                <td className="p-2 text-right">{m.lead_time_bdays}영업일</td>
                <td className="p-2 text-right">
                  {formatQty(Number(m.stock_qty))} {m.unit}
                </td>
                <td className="p-2 text-right">{formatQty(incoming.get(m.id) ?? 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-4 text-sm text-slate-600">
        여러 개를 한 번에 넣거나 재고를 고치려면{" "}
        <Link href="/import?kind=materials" className="underline">
          엑셀 가져오기
        </Link>
        를 쓰세요.
      </p>
    </div>
  );
}
