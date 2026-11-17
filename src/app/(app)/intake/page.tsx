import { requireUser } from "@/lib/auth";
import { loadPlanData } from "@/lib/data/plan-input";
import { loadIntakeItems } from "@/lib/intake/load";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/placeholder";
import { IntakeBoard, type IntakeRow } from "./intake-board";

export const metadata = { title: "받은 내용" };

const COLUMNS = "id, source, original_text, method, records, needs_review, reasons, status, created_at, decided_at, applied";

export default async function IntakePage() {
  await requireUser();
  const supabase = await createClient();

  let setupError: string | null = null;
  let loaded: Awaited<ReturnType<typeof loadIntakeItems>> | null = null;
  try {
    loaded = await loadIntakeItems(supabase);
  } catch (error) {
    setupError = error instanceof Error ? error.message : "불러오지 못했습니다.";
  }

  const [planData, pending, decided] = await Promise.all([
    loadPlanData(supabase),
    supabase.from("intake_items").select(COLUMNS).eq("status", "pending").order("created_at", { ascending: false }),
    supabase.from("intake_items").select(COLUMNS).neq("status", "pending").order("decided_at", { ascending: false }).limit(20),
  ]);
  if (!setupError && (pending.error || decided.error)) {
    setupError = "DB에 '받은 내용' 기능이 아직 설치되지 않았습니다. Supabase SQL Editor에서 supabase/migrations/0004_intake.sql 을 실행해 주세요.";
  }

  return (
    <div>
      <PageHeader
        title="받은 내용"
        description="말이나 글로 받은 재고·일정 변경을 정리합니다. 확인해서 확정해야 재고와 생산일정에 반영됩니다."
      />
      {setupError || !loaded ? (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{setupError}</p>
      ) : (
        <IntakeBoard
          items={loaded.items}
          context={loaded.context}
          planInput={planData.input}
          pending={(pending.data ?? []) as IntakeRow[]}
          decided={(decided.data ?? []) as IntakeRow[]}
        />
      )}
    </div>
  );
}
