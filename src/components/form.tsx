"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { IDLE, type ActionState } from "@/lib/validation";

export const inputClass = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100";

export function Field({
  label,
  name,
  error,
  hint,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function SubmitButton({ children, className }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={className ?? "rounded bg-slate-900 px-4 py-1.5 text-sm text-white disabled:opacity-50"}
    >
      {pending ? "저장 중…" : children}
    </button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return <p className={`text-sm ${state.status === "error" ? "text-red-600" : "text-emerald-700"}`}>{state.message}</p>;
}

/** 확인 창을 띄운 뒤 삭제한다. 삭제 실패(다른 데이터가 쓰는 중 등)는 옆에 표시 */
export function DeleteButton({
  action,
  fields,
  confirmText,
  label = "삭제",
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  fields: Record<string, string>;
  confirmText: string;
  label?: string;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
      className="inline"
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button type="submit" disabled={pending} className="text-xs text-red-700 underline disabled:opacity-50">
        {label}
      </button>
      {state.status === "error" && <span className="ml-2 text-xs text-red-600">{state.message}</span>}
    </form>
  );
}
