import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { signOut } from "../login/actions";

const NAV = [
  { href: "/", label: "발주 체크리스트" },
  { href: "/schedule", label: "일정 보기" },
  { href: "/projects", label: "프로젝트" },
  { href: "/materials", label: "부자재" },
  { href: "/products", label: "제품·BOM" },
  { href: "/import", label: "엑셀 가져오기" },
  { href: "/settings", label: "설정·휴일" },
  { href: "/team", label: "팀원" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <>
      <header className="border-b border-slate-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-bold">부자재 발주</span>
          <nav className="flex flex-wrap gap-4 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-slate-600 hover:text-slate-900">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-500">
            <span>
              {user.name || user.email}
              {user.role === "admin" && " (관리자)"}
            </span>
            <form action={signOut}>
              <button type="submit" className="underline">
                로그아웃
              </button>
            </form>
          </div>
        </div>
      </header>
      <RealtimeRefresh />
      <main className="mx-auto max-w-7xl px-4 py-6 print:max-w-none print:p-0">{children}</main>
    </>
  );
}
