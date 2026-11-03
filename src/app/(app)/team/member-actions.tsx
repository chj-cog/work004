"use client";

import { useActionState } from "react";
import { IDLE } from "@/lib/validation";
import { updateMember } from "./actions";

const LABELS = {
  approve: "승인",
  revoke: "승인 취소",
  make_admin: "관리자로",
  make_member: "팀원으로",
} as const;

export function MemberActions({ id, approved, role }: { id: string; approved: boolean; role: "admin" | "member" }) {
  const [state, action, pending] = useActionState(updateMember, IDLE);
  const changes: (keyof typeof LABELS)[] = approved ? ["revoke", role === "admin" ? "make_member" : "make_admin"] : ["approve"];
  return (
    <div className="flex items-center justify-end gap-2">
      {changes.map((change) => (
        <form key={change} action={action}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="change" value={change} />
          <button
            type="submit"
            disabled={pending}
            className={`rounded px-2 py-1 text-xs disabled:opacity-50 ${change === "approve" ? "bg-emerald-700 text-white" : "border border-slate-400"}`}
          >
            {LABELS[change]}
          </button>
        </form>
      ))}
      {state.status === "error" && <span className="text-xs text-red-600">{state.message}</span>}
    </div>
  );
}
