import { redirect } from "next/navigation";
import { connection } from "next/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { SetupNotice } from "@/components/setup-notice";
import { LoginForm } from "./login-form";

export const metadata = { title: "로그인 · 부자재 발주 체크리스트" };

export default async function LoginPage() {
  await connection();
  if (hasSupabaseEnv()) {
    // 이미 로그인했으면 체크리스트로
    const { data } = await (await createClient()).auth.getClaims();
    if (data?.claims) redirect("/");
  }
  return (
    <main className="mx-auto mt-24 max-w-sm px-4">
      <h1 className="mb-1 text-xl font-bold">부자재 발주 체크리스트</h1>
      <p className="mb-6 text-sm text-slate-500">가입 후 관리자 승인을 받은 팀원만 사용할 수 있습니다.</p>
      {hasSupabaseEnv() ? <LoginForm /> : <SetupNotice />}
    </main>
  );
}
