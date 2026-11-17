import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInSeoul } from "@/lib/dates";
import { buildContext, buildItems, type IntakeContext, type IntakeItems, type MaterialSource, type ProjectSource } from "./types";

/** 0004_intake.sql 을 아직 실행하지 않았을 때 나오는 오류를 알아볼 수 있는 말로 바꾼다 */
export function dbMessage(error: { code?: string; message: string }): string {
  if (error.code === "42703" || error.code === "42P01" || error.code === "PGRST204" || error.code === "PGRST205" || error.code === "PGRST202") {
    return "DB에 '받은 내용' 기능이 아직 설치되지 않았습니다. Supabase SQL Editor에서 supabase/migrations/0004_intake.sql 을 실행해 주세요.";
  }
  return error.message;
}

export async function loadIntakeItems(supabase: SupabaseClient): Promise<{ items: IntakeItems; context: IntakeContext }> {
  const [materials, projects] = await Promise.all([
    supabase.from("materials").select("id, name, unit, aliases, packs").order("id"),
    supabase.from("projects").select("id, name, aliases, start_date, status").order("start_date"),
  ]);
  if (materials.error) throw new Error(dbMessage(materials.error));
  if (projects.error) throw new Error(dbMessage(projects.error));
  const projectRows = projects.data as ProjectSource[];
  return { items: buildItems(materials.data as MaterialSource[], projectRows), context: buildContext(todayInSeoul(), projectRows) };
}
