import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { hasSupabaseEnv } from "./supabase/env";
import { createClient } from "./supabase/server";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  approved: boolean;
}

/** 로그인만 확인한다 (승인 여부와 무관). 승인 대기 화면에서 쓴다 */
export async function requireSignedIn(): Promise<CurrentUser> {
  // 요청마다 확인해야 하므로 빌드 시 정적 페이지로 굳지 않게 한다
  await connection();
  // 환경변수가 없으면 로그인 화면이 설정 안내를 보여준다
  if (!hasSupabaseEnv()) redirect("/login");
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("id, email, name, role, approved").eq("id", userId).single();
  if (!profile) redirect("/login");
  return profile as CurrentUser;
}

/** 승인된 팀원만 통과. 화면·서버 액션마다 다시 확인한다 (proxy만 믿지 않는다) */
export async function requireUser(): Promise<CurrentUser> {
  const user = await requireSignedIn();
  if (!user.approved) redirect("/pending");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("관리자만 할 수 있습니다");
  return user;
}
