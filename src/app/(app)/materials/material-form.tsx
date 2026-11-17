"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormMessage, inputClass, SubmitButton } from "@/components/form";
import { IDLE } from "@/lib/validation";
import { saveMaterial } from "./actions";

export interface MaterialFormValues {
  version: string;
  id: string;
  name: string;
  unit: string;
  order_unit: string;
  moq: string;
  lead_time_bdays: string;
  stock_qty: string;
  aliases: string;
  packs: string;
}

export function MaterialForm({ initial, mode }: { initial: MaterialFormValues; mode: "new" | "edit" }) {
  const [state, action] = useActionState(saveMaterial, IDLE);
  const v = { ...initial, ...state.values };
  const e = state.errors ?? {};

  return (
    <form action={action} key={JSON.stringify(state.values ?? {})} className="max-w-xl space-y-4 rounded border border-slate-200 bg-white p-4">
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="version" value={initial.version} />

      <div className="grid grid-cols-[10rem_1fr] gap-4">
        <Field label="코드" name="id" error={e.id} hint={mode === "edit" ? "코드는 바꿀 수 없습니다." : undefined}>
          <input id="id" name="id" defaultValue={v.id} required readOnly={mode === "edit"} className={`${inputClass} read-only:bg-slate-100`} />
        </Field>
        <Field label="이름" name="name" error={e.name}>
          <input id="name" name="name" defaultValue={v.name} required className={inputClass} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Field label="단위" name="unit" error={e.unit} hint="개, m, kg 등">
          <input id="unit" name="unit" defaultValue={v.unit} className={inputClass} />
        </Field>
        <Field label="발주 단위" name="order_unit" error={e.order_unit} hint="발주수량은 이 값의 배수">
          <input id="order_unit" name="order_unit" inputMode="decimal" defaultValue={v.order_unit} required className={inputClass} />
        </Field>
        <Field label="최소 발주수량 (MOQ)" name="moq" error={e.moq} hint="없으면 비워 두세요">
          <input id="moq" name="moq" inputMode="decimal" defaultValue={v.moq} className={inputClass} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Field label="리드타임 (영업일)" name="lead_time_bdays" error={e.lead_time_bdays} hint="주말·공휴일 제외">
          <input id="lead_time_bdays" name="lead_time_bdays" inputMode="numeric" defaultValue={v.lead_time_bdays} required className={inputClass} />
        </Field>
        <Field label="현재 재고" name="stock_qty" error={e.stock_qty} hint="실재고 (입고 예정 제외)">
          <input id="stock_qty" name="stock_qty" inputMode="decimal" defaultValue={v.stock_qty} className={inputClass} />
        </Field>
      </div>

      <fieldset className="space-y-4 rounded border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium">말·글로 받은 내용을 정리할 때 쓰는 정보</legend>
        <Field label="다르게 부르는 이름" name="aliases" error={e.aliases} hint="쉼표로 구분. 예: 스크류, 볼트">
          <input id="aliases" name="aliases" defaultValue={v.aliases} className={inputClass} />
        </Field>
        <Field label="포장 단위" name="packs" error={e.packs} hint="'이름=낱개 수'를 쉼표로 구분. 예: 박스=800, 봉지=100">
          <input id="packs" name="packs" defaultValue={v.packs} className={inputClass} />
        </Field>
      </fieldset>

      <FormMessage state={state} />
      <div className="flex items-center gap-3">
        <SubmitButton>저장</SubmitButton>
        <Link href="/materials" className="text-sm text-slate-600 underline">
          취소
        </Link>
      </div>
    </form>
  );
}
