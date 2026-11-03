import Link from "next/link";
import { createCalendar } from "@/engine";
import { requireUser } from "@/lib/auth";
import { formatDate, formatQty } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/placeholder";

export const metadata = { title: "프로젝트" };

const STATUS = { planned: "계획", in_progress: "진행", done: "완료", cancelled: "취소" } as const;

export default async function ProjectsPage() {
  await requireUser();
  const supabase = await createClient();
  const [{ data: projects }, { data: holidays }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, product_id, production_qty, start_date, status, products(name)")
      .order("start_date")
      .returns<{ id: string; name: string; product_id: string; production_qty: number; start_date: string; status: keyof typeof STATUS; products: { name: string } | null }[]>(),
    supabase.from("holidays").select("date"),
  ]);
  const cal = createCalendar((holidays ?? []).map((h) => h.date as string));

  return (
    <div>
      <div className="flex items-start justify-between">
        <PageHeader title="프로젝트" description="생산일정. 한 프로젝트는 한 제품을 만듭니다." />
        <Link href="/projects/new" className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
          프로젝트 추가
        </Link>
      </div>
      <table className="w-full bg-white text-sm">
        <thead>
          <tr className="border-b-2 border-slate-300 text-left">
            <th className="p-2">프로젝트</th>
            <th className="p-2">제품</th>
            <th className="p-2 text-right">생산수량</th>
            <th className="p-2">생산시작일</th>
            <th className="p-2">상태</th>
          </tr>
        </thead>
        <tbody>
          {(projects ?? []).length === 0 && (
            <tr>
              <td colSpan={5} className="p-6 text-center text-slate-500">
                등록된 프로젝트가 없습니다.
              </td>
            </tr>
          )}
          {(projects ?? []).map((p) => (
            <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
              <td className="p-2">
                <Link href={`/projects/${p.id}`} className="font-medium underline-offset-2 hover:underline">
                  {p.name}
                </Link>
              </td>
              <td className="p-2">{p.products?.name ?? p.product_id}</td>
              <td className="p-2 text-right">{formatQty(Number(p.production_qty))}</td>
              <td className="p-2">
                {formatDate(p.start_date)}
                {!cal.isBusinessDay(p.start_date) && <span className="ml-2 text-xs text-amber-700">휴일 시작</span>}
              </td>
              <td className={`p-2 ${p.status === "done" || p.status === "cancelled" ? "text-slate-400" : ""}`}>{STATUS[p.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
