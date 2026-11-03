import { NextResponse, type NextRequest } from "next/server";
import { todayInSeoul } from "@/lib/dates";
import { syncHolidays, yearsToSync } from "@/lib/holidays/sync";
import { createAdminClient } from "@/lib/supabase/server";

/** Vercel Cron이 매일 호출한다 (vercel.json). CRON_SECRET으로 다른 호출을 막는다 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await syncHolidays(createAdminClient(), yearsToSync(todayInSeoul()));
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
