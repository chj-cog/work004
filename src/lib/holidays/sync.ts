import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPublicHolidays } from "./special-days";

export interface SyncResult {
  ok: boolean;
  years: number[];
  count: number;
  error?: string;
}

/**
 * 특일정보 API에서 받은 공휴일로 holidays 테이블의 source=api 행을 바꾼다.
 * 수동으로 넣은 회사 휴무일은 건드리지 않는다. 실패하면 기존 데이터를 그대로 두고 오류만 기록한다.
 */
export async function syncHolidays(admin: SupabaseClient, years: number[]): Promise<SyncResult> {
  const serviceKey = process.env.HOLIDAY_API_KEY;
  const now = new Date().toISOString();
  try {
    if (!serviceKey) throw new Error("HOLIDAY_API_KEY가 설정되지 않았습니다");
    const fetched = (await Promise.all(years.map((y) => fetchPublicHolidays(y, serviceKey)))).flat();

    const { data: manual, error: manualError } = await admin.from("holidays").select("date").eq("source", "manual");
    if (manualError) throw manualError;
    const manualDates = new Set((manual ?? []).map((h) => h.date as string));

    // 같은 날 공휴일이 두 개(예: 어린이날과 부처님오신날)면 이름을 합친다
    const byDate = new Map<string, string>();
    for (const h of fetched) {
      if (manualDates.has(h.date)) continue;
      byDate.set(h.date, byDate.has(h.date) ? `${byDate.get(h.date)}·${h.name}` : h.name);
    }
    const rows = [...byDate].map(([date, name]) => ({ date, name, type: "public", source: "api", synced_at: now }));

    if (rows.length > 0) {
      const { error } = await admin.from("holidays").upsert(rows, { onConflict: "date" });
      if (error) throw error;
    }
    // 취소된 공휴일 정리: 이번에 받은 연도 범위에서 API에 더는 없는 날을 지운다
    for (const year of years) {
      const keep = rows.filter((r) => r.date.startsWith(`${year}-`)).map((r) => r.date);
      let del = admin.from("holidays").delete().eq("source", "api").gte("date", `${year}-01-01`).lte("date", `${year}-12-31`);
      if (keep.length > 0) del = del.not("date", "in", `(${keep.join(",")})`);
      const { error } = await del;
      if (error) throw error;
    }

    await admin.from("settings").update({ holiday_synced_at: now, holiday_sync_error: null }).eq("id", true);
    return { ok: true, years, count: rows.length };
  } catch (e) {
    // Supabase 오류는 Error가 아닌 { code, message } 객체로 온다
    const message =
      e instanceof Error ? e.message : typeof e === "object" && e !== null && "message" in e ? `${(e as { code?: string }).code ?? ""} ${String(e.message)}`.trim() : String(e);
    await admin.from("settings").update({ holiday_sync_error: `${now} ${message}` }).eq("id", true);
    return { ok: false, years, count: 0, error: message };
  }
}

export function yearsToSync(today: string): number[] {
  const year = Number(today.slice(0, 4));
  return [year, year + 1];
}
