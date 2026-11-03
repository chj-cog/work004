"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { failure, invalid, parseSignIn, parseSignUp, type ActionState } from "@/lib/validation";

/** Supabase 인증 오류 → 사용자에게 보여줄 문장. 원인은 서버 로그에 남긴다 */
function authErrorMessage(error: { code?: string; message: string }, where: string): string {
  console.error(`[${where}]`, error.code ?? "", error.message);
  switch (error.code) {
    case "invalid_credentials":
      return "이메일 또는 비밀번호가 맞지 않습니다.";
    case "email_not_confirmed":
      return "가입 확인 메일의 링크를 먼저 눌러 주세요.";
    case "user_already_exists":
    case "email_exists":
      return "이미 가입된 이메일입니다. 로그인해 주세요.";
    case "weak_password":
      return "비밀번호가 너무 약합니다. 더 길게 만들어 주세요.";
    case "signup_disabled":
      return "회원가입이 꺼져 있습니다. 관리자에게 Supabase 설정(Allow new users to sign up)을 확인해 달라고 해 주세요.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "요청이 너무 많습니다. 몇 분 뒤에 다시 시도해 주세요.";
    default:
      return "처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
  }
}

export async function signIn(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = parseSignIn(fd);
  if (!parsed.data) return invalid(parsed.errors, fd);
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return failure(authErrorMessage(error, "signIn"), fd);
  redirect("/");
}

export async function signUp(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = parseSignUp(fd);
  if (!parsed.data) return invalid(parsed.errors, fd);
  const { name, email, password } = parsed.data;

  const origin = (await headers()).get("origin") ?? "";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name }, emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) return failure(authErrorMessage(error, "signUp"), fd);
  // Supabase에서 "Confirm email"이 켜져 있으면 세션 없이 확인 메일만 간다
  if (!data.session) {
    return { status: "ok", message: `${email}로 가입 확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 로그인해 주세요.` };
  }
  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
