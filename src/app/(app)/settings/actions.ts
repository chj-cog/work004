"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { todayInSeoul } from "@/lib/dates";
import { syncHolidays, yearsToSync } from "@/lib/holidays/sync";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { dbErrorMessage, failure, invalid, parseHoliday, parseSettings, type ActionState } from "@/lib/validation";

export async function syncHolidaysNow(): Promise<void> {
  await requireAdmin();
  await syncHolidays(createAdminClient(), yearsToSync(todayInSeoul()));
  revalidatePath("/", "layout");
}

export async function saveSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = parseSettings(fd);
  if (!parsed.data) return invalid(parsed.errors, fd);
  const supabase = await createClient();
  const { error } = await supabase.from("settings").update(parsed.data).eq("id", true);
  if (error) return failure(dbErrorMessage(error, "설정"), fd);
  revalidatePath("/", "layout");
  return { status: "ok", message: "저장했습니다. 체크리스트가 새 기준으로 다시 계산됩니다." };
}

/** 회사 휴무일 추가. 같은 날 공휴일이 있으면 회사 휴무로 덮지 않는다 */
export async function addCompanyHoliday(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = parseHoliday(fd);
  if (!parsed.data) return invalid(parsed.errors, fd);
  const supabase = await createClient();
  const { error } = await supabase.from("holidays").insert({ ...parsed.data, type: "company", source: "manual" });
  if (error) {
    const message = error.code === "23505" ? "이미 휴일로 등록된 날입니다." : dbErrorMessage(error, "휴일");
    return failure(message, fd);
  }
  revalidatePath("/", "layout");
  return { status: "ok", message: `${parsed.data.date} ${parsed.data.name}을(를) 추가했습니다.` };
}

export async function deleteCompanyHoliday(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  // API로 받은 공휴일은 지우지 않는다 (다음 동기화 때 다시 생기므로)
  const { error } = await supabase.from("holidays").delete().eq("date", String(fd.get("date"))).eq("source", "manual");
  if (error) return failure(dbErrorMessage(error, "휴일"));
  revalidatePath("/", "layout");
  return { status: "ok" };
}
