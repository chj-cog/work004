"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CONFLICT_MESSAGE, dbErrorMessage, failure, invalid, parseProject, type ActionState } from "@/lib/validation";

export async function saveProject(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = parseProject(fd);
  if (!parsed.data) return invalid(parsed.errors, fd);

  const id = String(fd.get("id") ?? "");
  const version = String(fd.get("version") ?? "");
  const row = { ...parsed.data, updated_at: new Date().toISOString(), updated_by: user.id };
  const supabase = await createClient();

  if (id) {
    // 불러온 뒤 다른 팀원이 고쳤으면 updated_at이 달라 0건이 수정된다
    const { data, error } = await supabase.from("projects").update(row).eq("id", id).eq("updated_at", version).select("id");
    if (error) return failure(dbErrorMessage(error, "프로젝트"), fd);
    if (!data || data.length === 0) return failure(CONFLICT_MESSAGE, fd);
  } else {
    const { error } = await supabase.from("projects").insert(row);
    if (error) return failure(dbErrorMessage(error, "프로젝트"), fd);
  }
  revalidatePath("/", "layout");
  redirect("/projects");
}

export async function deleteProject(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("projects").delete().eq("id", String(fd.get("id")));
  if (error) return failure(dbErrorMessage(error, "프로젝트"));
  revalidatePath("/", "layout");
  redirect("/projects");
}
