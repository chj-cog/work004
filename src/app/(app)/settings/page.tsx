import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { DeleteButton } from "@/components/form";
import { PageHeader } from "@/components/placeholder";
import { deleteCompanyHoliday, syncHolidaysNow } from "./actions";
import { AddHolidayForm, SettingsForm } from "./settings-forms";

export const metadata = { title: "설정·휴일" };

export default async function SettingsPage() {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const supabase = await createClient();
  const [{ data: settings }, { data: holidays }] = await Promise.all([
    supabase.from("settings").select("*").single(),
    supabase.from("holidays").select("date, name, type, source").order("date"),
  ]);
  const thisYear = new Date().getFullYear();
  const shown = (holidays ?? []).filter((h) => Number(h.date.slice(0, 4)) >= thisYear - 1);

  return (
    <div className="space-y-6">
      <PageHeader title="설정·휴일" description={isAdmin ? "계산 기준값과 영업일 달력" : "계산 기준값과 영업일 달력 (변경은 관리자만 할 수 있습니다)"} />

      <section className="rounded border border-slate-200 bg-white p-4 text-sm">
        <h2 className="mb-3 font-semibold">계산 기준</h2>
        {isAdmin ? (
          <SettingsForm
            initial={{
              buffer_bdays: String(settings?.buffer_bdays ?? 3),
              imminent_bdays: String(settings?.imminent_bdays ?? 3),
              merge_window_bdays: String(settings?.merge_window_bdays ?? 5),
            }}
          />
        ) : (
          <dl className="grid grid-cols-[10rem_1fr] gap-y-1">
            <dt>여유일</dt>
            <dd>{settings?.buffer_bdays}영업일</dd>
            <dt>임박 기준</dt>
            <dd>{settings?.imminent_bdays}영업일 이내</dd>
            <dt>발주 합치기 기간</dt>
            <dd>{settings?.merge_window_bdays}영업일</dd>
          </dl>
        )}
      </section>

      <section className="rounded border border-slate-200 bg-white p-4 text-sm">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">휴일</h2>
          {isAdmin && (
            <form action={syncHolidaysNow}>
              <button type="submit" className="rounded border border-slate-400 px-3 py-1 text-xs">
                공휴일 지금 동기화
              </button>
            </form>
          )}
        </div>
        <p className="mb-1 text-slate-500">
          공휴일 마지막 동기화:{" "}
          {settings?.holiday_synced_at ? new Date(settings.holiday_synced_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "없음"}
        </p>
        {settings?.holiday_sync_error && <p className="mb-2 text-red-700">동기화 실패: {settings.holiday_sync_error}</p>}

        {isAdmin && (
          <div className="my-4 border-y border-slate-100 py-3">
            <AddHolidayForm />
          </div>
        )}

        <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 md:grid-cols-3">
          {shown.map((h) => (
            <li key={h.date} className="flex items-center gap-2">
              <span>
                {h.date.slice(0, 4)}-{formatDate(h.date)} {h.name}
              </span>
              {h.source === "manual" && (
                <>
                  <span className="text-xs text-slate-500">회사 휴무</span>
                  {isAdmin && (
                    <DeleteButton
                      action={deleteCompanyHoliday}
                      fields={{ date: h.date }}
                      confirmText={`${h.date} ${h.name}을(를) 삭제할까요?`}
                    />
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
