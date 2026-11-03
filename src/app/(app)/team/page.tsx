import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/placeholder";
import { MemberActions } from "./member-actions";

export const metadata = { title: "팀원" };

interface MemberRow {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  approved: boolean;
}

export default async function TeamPage() {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, email, name, role, approved").order("created_at").returns<MemberRow[]>();
  const members = data ?? [];
  const waiting = members.filter((m) => !m.approved).length;

  return (
    <div>
      <PageHeader
        title="팀원"
        description={isAdmin ? "가입한 사람을 승인해야 데이터를 볼 수 있습니다." : "팀원 승인과 역할 변경은 관리자만 할 수 있습니다."}
      />
      {isAdmin && waiting > 0 && <p className="mb-3 rounded bg-amber-50 p-3 text-sm text-amber-900">승인 대기 {waiting}명</p>}
      <table className="w-full bg-white text-sm">
        <thead>
          <tr className="border-b-2 border-slate-300 text-left">
            <th className="p-2">이름</th>
            <th className="p-2">이메일</th>
            <th className="p-2">역할</th>
            <th className="p-2">상태</th>
            {isAdmin && <th className="p-2" />}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id} className="border-b border-slate-100">
              <td className="p-2">
                {m.name || "—"}
                {m.id === user.id && <span className="ml-1 text-xs text-slate-500">(나)</span>}
              </td>
              <td className="p-2">{m.email}</td>
              <td className="p-2">{m.role === "admin" ? "관리자" : "팀원"}</td>
              <td className={`p-2 ${m.approved ? "" : "font-semibold text-amber-700"}`}>{m.approved ? "승인됨" : "승인 대기"}</td>
              {isAdmin && <td className="p-2">{m.id !== user.id && <MemberActions id={m.id} approved={m.approved} role={m.role} />}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
