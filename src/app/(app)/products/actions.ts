"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage, failure, invalid, parseBomItem, parseProduct, type ActionState } from "@/lib/validation";

const productPath = (id: string) => `/products/${encodeURIComponent(id)}`;

export async function createProduct(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = parseProduct(fd);
  if (!parsed.data) return invalid(parsed.errors, fd);
  const supabase = await createClient();
  const { error } = await supabase.from("products").insert(parsed.data);
  if (error) return failure(dbErrorMessage(error, "제품"), fd);
  revalidatePath("/products");
  // 바로 BOM을 입력하도록 제품 화면으로 보낸다
  redirect(productPath(parsed.data.id));
}

export async function renameProduct(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = parseProduct(fd);
  if (!parsed.data) return invalid(parsed.errors, fd);
  const supabase = await createClient();
  const { error } = await supabase.from("products").update({ name: parsed.data.name }).eq("id", parsed.data.id);
  if (error) return failure(dbErrorMessage(error, "제품"), fd);
  revalidatePath("/", "layout");
  return { status: "ok", message: "저장했습니다." };
}

export async function deleteProduct(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("products").delete().eq("id", String(fd.get("id")));
  if (error) return failure(dbErrorMessage(error, "제품"));
  revalidatePath("/", "layout");
  redirect("/products");
}

/** BOM 한 줄 추가 또는 소요량 변경 */
export async function saveBomItem(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const productId = String(fd.get("product_id") ?? "");
  const parsed = parseBomItem(fd);
  if (!parsed.data) return invalid(parsed.errors, fd);
  const supabase = await createClient();
  const { error } = await supabase
    .from("bom_items")
    .upsert({ product_id: productId, ...parsed.data }, { onConflict: "product_id,material_id" });
  if (error) return failure(dbErrorMessage(error, "BOM"), fd);
  revalidatePath("/", "layout");
  return { status: "ok", message: "저장했습니다." };
}

export async function deleteBomItem(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("bom_items")
    .delete()
    .eq("product_id", String(fd.get("product_id")))
    .eq("material_id", String(fd.get("material_id")));
  if (error) return failure(dbErrorMessage(error, "BOM"));
  revalidatePath("/", "layout");
  return { status: "ok" };
}
