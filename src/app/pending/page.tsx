import { redirect } from "next/navigation";
import { requireSignedIn } from "@/lib/auth";
import { signOut } from "../login/actions";

export const metadata = { title: "승인 대기 · 부자재 발주 체크리스트" };

export default async function PendingPage() {
  const user = await requireSignedIn();
  if (user.approved) redirect("/");

  return (
    <main className="mx-auto mt-24 max-w-sm space-y-4 px-4">
      <h1 className="text-xl font-bold">관리자 승인 대기 중</h1>
      <p className="text-sm text-slate-600">
        {user.name || user.email}님, 가입이 완료되었습니다. 관리자가 팀원 화면에서 승인하면 사용할 수 있습니다. 승인 후 이 페이지를 새로고침하세요.
      </p>
      <form action={signOut}>
        <button type="submit" className="text-sm underline">
          로그아웃
        </button>
      </form>
    </main>
  );
}
