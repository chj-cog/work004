"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth";
import { readUploadedTable } from "@/lib/import/read-file";
import { IMPORT_KINDS, parseTable, type ImportKind, type ImportResult } from "@/lib/import/sheet";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage } from "@/lib/validation";

export interface ImportState {
  status: "idle" | "preview" | "done" | "error";
  message?: string;
  kind?: ImportKind;
  fileName?: string;
  /** 적용할 때 다시 검사하기 위해 읽은 표를 그대로 돌려보낸다 */
  table?: string[][];
  result?: ImportResult;
}

const isKind = (v: unknown): v is ImportKind => IMPORT_KINDS.some((k) => k.kind === v);

async function loadContext(supabase: SupabaseClient) {
  const [{ data: materials, error: e1 }, { data: products, error: e2 }] = await Promise.all([
    supabase.from("materials").select("id"),
    supabase.from("products").select("id"),
  ]);
  if (e1 || e2) throw new Error("기존 데이터를 불러오지 못했습니다.");
  return {
    materialIds: new Set((materials ?? []).map((m) => m.id as string)),
    productIds: new Set((products ?? []).map((p) => p.id as string)),
  };
}

/** 1단계: 파일을 읽고 검사한 결과를 보여준다. DB는 바꾸지 않는다 */
export async function previewImport(_prev: ImportState, fd: FormData): Promise<ImportState> {
  await requireUser();
  const kind = fd.get("kind");
  const file = fd.get("file");
  if (!isKind(kind)) return { status: "error", message: "가져올 종류를 고르세요." };
  if (!(file instanceof File) || file.size === 0) return { status: "error", kind, message: "파일을 선택하세요." };

  try {
    const table = await readUploadedTable(file);
    const supabase = await createClient();
    const result = parseTable(kind, table, await loadContext(supabase));
    return { status: "preview", kind, fileName: file.name, table, result };
  } catch (e) {
    return { status: "error", kind, message: e instanceof Error ? e.message : String(e) };
  }
}

/** 2단계: 미리보기에서 확인한 표를 다시 검사하고, 오류가 없을 때만 한꺼번에 반영한다 */
export async function applyImport(prev: ImportState, fd: FormData): Promise<ImportState> {
  const user = await requireUser();
  const kind = fd.get("kind");
  let table: string[][];
  try {
    table = JSON.parse(String(fd.get("table") ?? ""));
    if (!Array.isArray(table) || !table.every((r) => Array.isArray(r) && r.every((c) => typeof c === "string"))) throw new Error();
  } catch {
    return { status: "error", message: "가져올 내용이 올바르지 않습니다. 파일을 다시 올려 주세요." };
  }
  if (!isKind(kind)) return { status: "error", message: "가져올 종류를 고르세요." };

  const supabase = await createClient();
  const result = parseTable(kind, table, await loadContext(supabase));
  // 미리보기 뒤에 다른 팀원이 데이터를 바꿨을 수 있으므로 다시 검사한 결과로 판단한다
  if (result.errors.length > 0 || result.rows.length === 0) {
    return { ...prev, status: "preview", kind, table, result, message: "검사에서 오류가 나와 반영하지 않았습니다. 오류를 고친 파일을 다시 올려 주세요." };
  }

  const now = new Date().toISOString();
  let error: { code?: string; message: string } | null = null;
  if (kind === "materials") {
    const rows = result.rows.flatMap((r) => (r.kind === "materials" ? [{ ...r.data, updated_at: now, updated_by: user.id }] : []));
    ({ error } = await supabase.from("materials").upsert(rows, { onConflict: "id" }));
  } else if (kind === "bom") {
    const rows = result.rows.flatMap((r) => (r.kind === "bom" ? [r.data] : []));
    ({ error } = await supabase.rpc("import_bom", { p_rows: rows }));
  } else {
    const rows = result.rows.flatMap((r) => (r.kind === "stock" ? [r.data] : []));
    ({ error } = await supabase.rpc("import_stock", { p_rows: rows }));
  }
  if (error) return { ...prev, status: "error", message: dbErrorMessage(error, "데이터") };

  revalidatePath("/", "layout");
  const created = result.rows.filter((r) => r.action === "create").length;
  return {
    status: "done",
    kind,
    message: `${result.rows.length}행을 반영했습니다${created > 0 ? ` (신규 ${created}행)` : ""}. 발주 체크리스트가 새 값으로 다시 계산됩니다.`,
  };
}
