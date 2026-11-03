"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, inputClass, SubmitButton } from "@/components/form";
import { IDLE, MIN_PASSWORD_LENGTH } from "@/lib/validation";
import { signIn, signUp } from "./actions";

const submitClass = "w-full rounded bg-slate-900 py-2 text-white disabled:opacity-50";

export function LoginForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 rounded border border-slate-300 p-0.5 text-sm" role="tablist">
        {(
          [
            ["signin", "로그인"],
            ["signup", "회원가입"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => setMode(value)}
            className={`rounded py-1.5 ${mode === value ? "bg-slate-900 text-white" : "text-slate-600"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "signin" ? <SignInForm /> : <SignUpForm />}
    </div>
  );
}

function SignInForm() {
  const [state, action] = useActionState(signIn, IDLE);
  const e = state.errors ?? {};
  return (
    <form action={action} key={JSON.stringify(state.values ?? {})} className="space-y-3">
      <Field label="이메일" name="email" error={e.email}>
        <input id="email" name="email" type="email" required autoComplete="email" defaultValue={state.values?.email} className={inputClass} />
      </Field>
      <Field label="비밀번호" name="password" error={e.password}>
        <input id="password" name="password" type="password" required autoComplete="current-password" className={inputClass} />
      </Field>
      <SubmitButton className={submitClass}>로그인</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

function SignUpForm() {
  const [state, action] = useActionState(signUp, IDLE);
  const e = state.errors ?? {};
  const v = state.values ?? {};
  if (state.status === "ok") return <FormMessage state={state} />;
  return (
    <form action={action} key={JSON.stringify(v)} className="space-y-3">
      <Field label="이름" name="name" error={e.name}>
        <input id="name" name="name" required autoComplete="name" defaultValue={v.name} className={inputClass} />
      </Field>
      <Field label="이메일" name="email" error={e.email}>
        <input id="email" name="email" type="email" required autoComplete="email" defaultValue={v.email} className={inputClass} />
      </Field>
      <Field label="비밀번호" name="password" error={e.password} hint={`${MIN_PASSWORD_LENGTH}자 이상`}>
        <input id="password" name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" className={inputClass} />
      </Field>
      <Field label="비밀번호 확인" name="password_confirm" error={e.password_confirm}>
        <input id="password_confirm" name="password_confirm" type="password" required autoComplete="new-password" className={inputClass} />
      </Field>
      <SubmitButton className={submitClass}>가입하기</SubmitButton>
      <p className="text-xs text-slate-500">가입 후 관리자가 승인하면 사용할 수 있습니다.</p>
      <FormMessage state={state} />
    </form>
  );
}
