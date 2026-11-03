"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/browser";

const TABLES = ["materials", "projects", "purchase_orders", "holidays"];

/** 다른 팀원이 데이터를 바꾸면 화면을 다시 그린다 (F7 실시간 반영) */
export function RealtimeRefresh() {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      // 여러 행이 한꺼번에 바뀔 때 한 번만 새로고침
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 300);
    };
    const channel = supabase.channel("data-changes");
    for (const table of TABLES) channel.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
    channel.subscribe();
    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [router]);
  return null;
}
