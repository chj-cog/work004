"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormMessage, inputClass, SubmitButton } from "@/components/form";
import { IDLE } from "@/lib/validation";
import { saveProject } from "./actions";

export interface ProjectFormValues {
  id: string;
  version: string;
  name: string;
  product_id: string;
  production_qty: string;
  start_date: string;
  status: string;
}

const STATUS_OPTIONS = [
  ["planned", "계획"],
  ["in_progress", "진행"],
  ["done", "완료"],
  ["cancelled", "취소"],
] as const;

export function ProjectForm({ initial, products }: { initial: ProjectFormValues; products: { id: string; name: string }[] }) {
  const [state, action] = useActionState(saveProject, IDLE);
  const v = { ...initial, ...state.values };
  const e = state.errors ?? {};

  return (
    <form action={action} key={JSON.stringify(state.values ?? {})} className="max-w-xl space-y-4 rounded border border-slate-200 bg-white p-4">
      <input type="hidden" name="id" value={initial.id} />
      <input type="hidden" name="version" value={initial.version} />

      <Field label="프로젝트명" name="name" error={e.name}>
        <input id="name" name="name" defaultValue={v.name} required className={inputClass} />
      </Field>
      <Field label="제품" name="product_id" error={e.product_id} hint="한 프로젝트는 한 제품을 만듭니다.">
        <select id="product_id" name="product_id" defaultValue={v.product_id} required className={inputClass}>
          <option value="">선택</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.id})
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="생산수량" name="production_qty" error={e.production_qty}>
          <input id="production_qty" name="production_qty" inputMode="decimal" defaultValue={v.production_qty} required className={inputClass} />
        </Field>
        <Field label="생산시작일" name="start_date" error={e.start_date}>
          <input id="start_date" name="start_date" type="date" defaultValue={v.start_date} required className={inputClass} />
        </Field>
      </div>
      <Field label="상태" name="status" error={e.status} hint="완료·취소한 프로젝트는 발주 계산에서 빠집니다.">
        <select id="status" name="status" defaultValue={v.status} className={inputClass}>
          {STATUS_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>

      <FormMessage state={state} />
      <div className="flex items-center gap-3">
        <SubmitButton>저장</SubmitButton>
        <Link href="/projects" className="text-sm text-slate-600 underline">
          취소
        </Link>
      </div>
    </form>
  );
}
