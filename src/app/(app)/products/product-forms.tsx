"use client";

import { useActionState } from "react";
import { Field, FormMessage, inputClass, SubmitButton } from "@/components/form";
import { IDLE } from "@/lib/validation";
import { createProduct, renameProduct, saveBomItem } from "./actions";

const smallButton = "rounded border border-slate-400 px-2 py-1 text-xs disabled:opacity-50";

export function NewProductForm() {
  const [state, action] = useActionState(createProduct, IDLE);
  const v = state.values ?? {};
  const e = state.errors ?? {};
  return (
    <form action={action} key={JSON.stringify(v)} className="flex flex-wrap items-start gap-3 rounded border border-slate-200 bg-white p-3">
      <Field label="제품 코드" name="id" error={e.id}>
        <input id="id" name="id" defaultValue={v.id} required className={inputClass} />
      </Field>
      <Field label="제품명" name="name" error={e.name}>
        <input id="name" name="name" defaultValue={v.name} required className={inputClass} />
      </Field>
      <div className="pt-6">
        <SubmitButton>제품 추가</SubmitButton>
      </div>
      <div className="basis-full">
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function RenameProductForm({ id, name }: { id: string; name: string }) {
  const [state, action] = useActionState(renameProduct, IDLE);
  const v = { name, ...state.values };
  return (
    <form action={action} key={JSON.stringify(state.values ?? {})} className="flex items-end gap-3">
      <input type="hidden" name="id" value={id} />
      <Field label="제품명" name="name" error={state.errors?.name}>
        <input id="name" name="name" defaultValue={v.name} required className={inputClass} />
      </Field>
      <SubmitButton className={smallButton}>이름 저장</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

/** 기존 BOM 줄의 소요량 변경 */
export function BomQtyForm({ productId, materialId, qty }: { productId: string; materialId: string; qty: number }) {
  const [state, action] = useActionState(saveBomItem, IDLE);
  return (
    <form action={action} className="flex items-center justify-end gap-2">
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="material_id" value={materialId} />
      <input
        name="qty_per_unit"
        aria-label="소요량"
        inputMode="decimal"
        defaultValue={state.values?.qty_per_unit ?? String(qty)}
        key={state.values?.qty_per_unit ?? String(qty)}
        className={`${inputClass} w-24 text-right`}
      />
      <SubmitButton className={smallButton}>변경</SubmitButton>
      {state.status === "error" && <span className="text-xs text-red-600">{state.errors?.qty_per_unit ?? state.message}</span>}
    </form>
  );
}

export function AddBomItemForm({ productId, materials }: { productId: string; materials: { id: string; name: string; unit: string }[] }) {
  const [state, action] = useActionState(saveBomItem, IDLE);
  const v = state.values ?? {};
  const e = state.errors ?? {};
  if (materials.length === 0) return <p className="text-sm text-slate-500">추가할 수 있는 부자재가 없습니다. 부자재를 먼저 등록하세요.</p>;
  return (
    <form action={action} key={JSON.stringify(v)} className="flex flex-wrap items-start gap-3">
      <input type="hidden" name="product_id" value={productId} />
      <Field label="부자재" name="material_id" error={e.material_id}>
        <select id="material_id" name="material_id" defaultValue={v.material_id ?? ""} required className={inputClass}>
          <option value="">선택</option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.id}, {m.unit})
            </option>
          ))}
        </select>
      </Field>
      <Field label="제품 1개당 소요량" name="qty_per_unit" error={e.qty_per_unit}>
        <input id="qty_per_unit" name="qty_per_unit" inputMode="decimal" defaultValue={v.qty_per_unit} required className={`${inputClass} w-32`} />
      </Field>
      <div className="pt-6">
        <SubmitButton>BOM에 추가</SubmitButton>
      </div>
      {state.status === "error" && !state.errors && (
        <div className="basis-full">
          <FormMessage state={state} />
        </div>
      )}
    </form>
  );
}
