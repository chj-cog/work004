"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, failure, type ActionState } from "@/lib/validation";

type Change = { approved: boolean } | { role: "admin" | "member" };

const CHANGES: Record<string, Change> = {
  approve: { approved: true },
  revoke: { approved: false },
  make_admin: { role: "admin" },
  make_member: { role: "member" },
};

/** 팀원 승인·승인 취소·역할 변경 (관리자). 자기 자신은 바꾸지 못한다 — 관리자가 아무도 없게 되는 것을 막기 위해 */
export async function updateMember(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = String(fd.get("id") ?? "");
  const change = CHANGES[String(fd.get("change") ?? "")];
  if (!change) return failure("알 수 없는 요청입니다.");
  if (id === admin.id) return failure("자기 자신의 승인·역할은 바꿀 수 없습니다.");

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update(change).eq("id", id);
  if (error) return failure(dbErrorMessage(error, "팀원"));
  revalidatePath("/team");
  return { status: "ok" };
}
