"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { extractByRules } from "@/lib/intake/extract-rules";
import { dbMessage, loadIntakeItems } from "@/lib/intake/load";
import { validateRecords } from "@/lib/intake/types";
import { createClient } from "@/lib/supabase/server";

export interface IntakeResult {
  ok: boolean;
  message?: string;
}

const MAX_TEXT = 2000;

/** 글을 규칙으로 정리해서 확인함에 올린다 */
export async function createFromText(text: string): Promise<IntakeResult> {
  const user = await requireUser();
  const original = String(text ?? "").trim().slice(0, MAX_TEXT);
  if (!original) return { ok: false, message: "정리할 글을 넣어 주세요." };
  const supabase = await createClient();
  try {
    const { items, context } = await loadIntakeItems(supabase);
    const result = extractByRules(original, items, context);
    const { error } = await supabase.from("intake_items").insert({
      source: "text", original_text: original, method: "rules",
      records: result.records, needs_review: result.needsReview, reasons: result.reasons, created_by: user.id,
    });
    if (error) return { ok: false, message: dbMessage(error) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "정리하지 못했습니다." };
  }
  revalidatePath("/intake");
  return { ok: true };
}

/**
 * 이 PC의 도우미(Whisper + LLM)가 정리한 결과를 확인함에 올린다.
 * 도우미의 답을 그대로 믿지 않는다: 목록에 없는 품목이나 잘못된 값이 있으면 "확인 필요"로 올린다.
 */
export async function createFromHelper(payload: {
  source: "text" | "audio";
  text: string;
  method: string;
  records: unknown;
  needsReview: boolean;
  reasons: unknown;
}): Promise<IntakeResult> {
  const user = await requireUser();
  const original = String(payload?.text ?? "").trim().slice(0, MAX_TEXT);
  const supabase = await createClient();
  try {
    const { items } = await loadIntakeItems(supabase);
    const { records, errors } = validateRecords(payload?.records, items);
    const reasons = (Array.isArray(payload?.reasons) ? payload.reasons : []).map((r) => String(r).slice(0, 300)).slice(0, 20);
    if (!original) reasons.push("받아 적은 글이 비어 있음");
    const { error } = await supabase.from("intake_items").insert({
      source: payload?.source === "audio" ? "audio" : "text",
      original_text: original || "(받아 적은 글 없음)",
      method: String(payload?.method ?? "helper").slice(0, 80),
      records,
      needs_review: Boolean(payload?.needsReview) || errors.length > 0 || reasons.length > 0 || records.length === 0,
      reasons: [...reasons, ...errors],
      created_by: user.id,
    });
    if (error) return { ok: false, message: dbMessage(error) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "올리지 못했습니다." };
  }
  revalidatePath("/intake");
  return { ok: true };
}

/** 사람이 확인한 내용을 재고·생산일정에 반영한다 */
export async function confirmIntake(id: string, rawRecords: unknown): Promise<IntakeResult> {
  await requireUser();
  const supabase = await createClient();
  try {
    const { items } = await loadIntakeItems(supabase);
    const { records, errors } = validateRecords(rawRecords, items);
    if (errors.length) return { ok: false, message: errors.join(" ") };
    if (records.length === 0) return { ok: false, message: "반영할 내용이 없습니다. 줄을 추가하거나 버리기를 눌러 주세요." };
    const { error } = await supabase.rpc("confirm_intake", { p_id: id, p_records: records });
    if (error) return { ok: false, message: dbMessage(error) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "반영하지 못했습니다." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** 반영하지 않고 버린다 (기록은 남는다) */
export async function discardIntake(id: string): Promise<IntakeResult> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intake_items")
    .update({ status: "discarded", decided_at: new Date().toISOString(), decided_by: user.id })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (error) return { ok: false, message: dbMessage(error) };
  if (!data || data.length === 0) return { ok: false, message: "이미 처리한 항목입니다." };
  revalidatePath("/intake");
  return { ok: true };
}
