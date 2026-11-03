"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CONFLICT_MESSAGE, dbErrorMessage, failure, invalid, parseMaterial, type ActionState } from "@/lib/validation";

export async function saveMaterial(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = parseMaterial(fd);
  if (!parsed.data) return invalid(parsed.errors, fd);

  const isEdit = fd.get("mode") === "edit";
  const version = String(fd.get("version") ?? "");
  const row = { ...parsed.data, updated_at: new Date().toISOString(), updated_by: user.id };
  const supabase = await createClient();

  if (isEdit) {
    // 코드(id)는 바꾸지 않는다. 불러온 뒤 다른 팀원이 고쳤으면 0건이 수정된다
    const { id, ...rest } = row;
    const { data, error } = await supabase.from("materials").update(rest).eq("id", id).eq("updated_at", version).select("id");
    if (error) return failure(dbErrorMessage(error, "부자재"), fd);
    if (!data || data.length === 0) return failure(CONFLICT_MESSAGE, fd);
  } else {
    const { error } = await supabase.from("materials").insert(row);
    if (error) return failure(dbErrorMessage(error, "부자재"), fd);
  }
  revalidatePath("/", "layout");
  redirect("/materials");
}

export async function deleteMaterial(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("materials").delete().eq("id", String(fd.get("id")));
  if (error) return failure(dbErrorMessage(error, "부자재"));
  revalidatePath("/", "layout");
  redirect("/materials");
}
