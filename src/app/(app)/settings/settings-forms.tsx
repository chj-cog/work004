"use client";

import { useActionState } from "react";
import { Field, FormMessage, inputClass, SubmitButton } from "@/components/form";
import { IDLE } from "@/lib/validation";
import { addCompanyHoliday, saveSettings } from "./actions";

export function SettingsForm({ initial }: { initial: { buffer_bdays: string; imminent_bdays: string; merge_window_bdays: string } }) {
  const [state, action] = useActionState(saveSettings, IDLE);
  const v = { ...initial, ...state.values };
  const e = state.errors ?? {};
  return (
    <form action={action} key={JSON.stringify(state.values ?? {})} className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="여유일 (영업일)" name="buffer_bdays" error={e.buffer_bdays} hint="생산시작일 몇 영업일 전까지 입고 (2~3 권장)">
          <input id="buffer_bdays" name="buffer_bdays" inputMode="numeric" defaultValue={v.buffer_bdays} className={inputClass} />
        </Field>
        <Field label="임박 기준 (영업일)" name="imminent_bdays" error={e.imminent_bdays} hint="오늘부터 이 기간 안의 발주는 임박">
          <input id="imminent_bdays" name="imminent_bdays" inputMode="numeric" defaultValue={v.imminent_bdays} className={inputClass} />
        </Field>
        <Field label="발주 합치기 기간 (영업일)" name="merge_window_bdays" error={e.merge_window_bdays} hint="발주일 간격이 이 안이면 한 번에 발주">
          <input id="merge_window_bdays" name="merge_window_bdays" inputMode="numeric" defaultValue={v.merge_window_bdays} className={inputClass} />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton>기준 저장</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function AddHolidayForm() {
  const [state, action] = useActionState(addCompanyHoliday, IDLE);
  const v = state.values ?? {};
  const e = state.errors ?? {};
  return (
    <form action={action} key={JSON.stringify(v)} className="flex flex-wrap items-start gap-3">
      <Field label="날짜" name="date" error={e.date}>
        <input id="date" name="date" type="date" defaultValue={v.date} required className={inputClass} />
      </Field>
      <Field label="휴무 이름" name="name" error={e.name}>
        <input id="name" name="name" defaultValue={v.name} placeholder="예: 하계휴가" required className={inputClass} />
      </Field>
      <div className="pt-6">
        <SubmitButton>회사 휴무일 추가</SubmitButton>
      </div>
      <div className="basis-full">
        <FormMessage state={state} />
      </div>
    </form>
  );
}
