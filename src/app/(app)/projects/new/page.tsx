import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/placeholder";
import { ProjectForm } from "../project-form";

export const metadata = { title: "프로젝트 추가" };

export default async function NewProjectPage() {
  await requireUser();
  const supabase = await createClient();
  const { data: products } = await supabase.from("products").select("id, name").order("id");

  return (
    <div>
      <PageHeader title="프로젝트 추가" />
      <ProjectForm
        products={products ?? []}
        initial={{ id: "", version: "", name: "", product_id: "", production_qty: "", start_date: "", status: "planned" }}
      />
    </div>
  );
}
