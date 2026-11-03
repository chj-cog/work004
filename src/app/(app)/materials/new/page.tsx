import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/placeholder";
import { MaterialForm } from "../material-form";

export const metadata = { title: "부자재 추가" };

export default async function NewMaterialPage() {
  await requireUser();
  return (
    <div>
      <PageHeader title="부자재 추가" />
      <MaterialForm
        mode="new"
        initial={{ version: "", id: "", name: "", unit: "개", order_unit: "", moq: "", lead_time_bdays: "", stock_qty: "0" }}
      />
    </div>
  );
}
