"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { calculatePlan, type PlanInput } from "@/engine";
import { inputClass } from "@/components/form";
import { formatDate, formatQty } from "@/lib/dates";
import { transcribeInBrowser } from "@/lib/intake/browser-stt";
import { applyToPlanInput, diffOrders, validateRecords, type IntakeContext, type IntakeItems, type IntakeRecord } from "@/lib/intake/types";
import { confirmIntake, createFromHelper, createFromText, discardIntake } from "./actions";

/** 이 PC에서 도는 도우미 (poc/web/server.py). Whisper와 LLM이 여기서 돈다 */
const HELPER = "http://localhost:8765";

export interface IntakeRow {
  id: string;
  source: "text" | "audio";
  original_text: string;
  method: string;
  records: IntakeRecord[];
  needs_review: boolean;
  reasons: string[];
  status: "pending" | "confirmed" | "discarded";
  created_at: string;
  decided_at: string | null;
  applied: (IntakeRecord & { before?: Record<string, unknown> })[] | null;
}

interface Draft {
  kind: "stock_report" | "schedule_change";
  materialId: string;
  qty: string;
  projectId: string;
  startDate: string;
  productionQty: string;
}

const EMPTY: Draft = { kind: "stock_report", materialId: "", qty: "", projectId: "", startDate: "", productionQty: "" };

const toDraft = (r: IntakeRecord): Draft =>
  r.kind === "stock_report"
    ? { ...EMPTY, materialId: r.materialId, qty: String(r.qty) }
    : { ...EMPTY, kind: "schedule_change", projectId: r.projectId, startDate: r.startDate ?? "", productionQty: r.productionQty === undefined ? "" : String(r.productionQty) };

const fromDraft = (d: Draft) =>
  d.kind === "stock_report"
    ? { kind: d.kind, materialId: d.materialId, qty: d.qty }
    : { kind: d.kind, projectId: d.projectId, startDate: d.startDate, productionQty: d.productionQty };

const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const methodLabel = (m: string) =>
  m === "rules" ? "규칙으로 정리" : m.startsWith("browser-whisper") ? "브라우저에서 받아 적고 규칙으로 정리" : `LLM으로 정리 (${m})`;
const button = "rounded border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50";
const primary = "rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50";

export function IntakeBoard({
  items, context, planInput, pending, decided,
}: {
  items: IntakeItems;
  context: IntakeContext;
  planInput: PlanInput;
  pending: IntakeRow[];
  decided: IntakeRow[];
}) {
  return (
    <div className="space-y-6">
      <NewIntake items={items} context={context} />
      <section>
        <h2 className="mb-2 text-lg font-semibold">확인할 것 ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-500">확인할 내용이 없습니다. 위에서 글을 넣거나 녹음을 올려 보세요.</p>
        ) : (
          <div className="space-y-4">
            {pending.map((row) => (
              <IntakeCard key={row.id} row={row} items={items} planInput={planInput} />
            ))}
          </div>
        )}
      </section>
      <History rows={decided} items={items} />
    </div>
  );
}

function NewIntake({ items, context }: { items: IntakeItems; context: IntakeContext }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [helper, setHelper] = useState<"checking" | "on" | "off">("checking");
  const [useLlm, setUseLlm] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    const check = () =>
      fetch(`${HELPER}/api/health`, { signal: AbortSignal.timeout(2500) })
        .then((r) => r.json().then(() => r.ok))
        .catch(() => false)
        .then((ok) => alive && setHelper(ok ? "on" : "off"));
    check();
    const timer = setInterval(check, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const finish = (result: { ok: boolean; message?: string }, done: string) => {
    setMessage({ ok: result.ok, text: result.ok ? done : (result.message ?? "실패했습니다.") });
    if (result.ok) {
      setText("");
      router.refresh();
    }
  };

  async function viaHelper(body: Record<string, unknown>, source: "text" | "audio") {
    const res = await fetch(`${HELPER}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, items, context }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error ?? "PC 도우미가 처리하지 못했습니다.");
    return createFromHelper({ source, text: data.text, method: data.method, records: data.records, needsReview: data.needsReview, reasons: data.reasons });
  }

  async function submitText() {
    if (!text.trim()) return setMessage({ ok: false, text: "정리할 글을 넣어 주세요." });
    setBusy("정리하는 중…");
    setMessage(null);
    try {
      const result = helper === "on" && useLlm ? await viaHelper({ text }, "text") : await createFromText(text);
      finish(result, "정리해서 아래 '확인할 것'에 올렸습니다.");
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "정리하지 못했습니다." });
    } finally {
      setBusy("");
    }
  }

  async function submitAudio(blob: Blob) {
    if (blob.size > 15 * 1024 * 1024) return setMessage({ ok: false, text: "녹음이 너무 큽니다 (15MB 이하)." });
    setMessage(null);
    try {
      if (helper !== "on") {
        // PC 도우미가 없으면 이 브라우저 안에서 받아 적는다 (음성은 이 기기 밖으로 나가지 않는다)
        setBusy("모델을 준비하는 중… 처음에는 한 번 내려받습니다 (약 250MB).");
        const stt = await transcribeInBrowser(blob, (p) =>
          setBusy(p.stage === "download" ? `모델을 내려받는 중… ${p.percent ?? 0}% (처음 한 번만)` : `받아 적는 중… (${p.device})`),
        );
        if (!stt.text) throw new Error("받아 적은 글이 비어 있습니다. 더 또렷하게, 마이크에 가까이 말해 보세요.");
        setBusy("정리하는 중…");
        finish(await createFromText(stt.text, true), `받아 적고(${stt.seconds}초) 정리해서 아래 '확인할 것'에 올렸습니다.`);
        return;
      }
      setBusy("받아 적고 정리하는 중… 처음에는 1분쯤 걸립니다.");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      finish(await viaHelper({ audioBase64: btoa(binary) }, "audio"), "받아 적고 정리해서 아래 '확인할 것'에 올렸습니다.");
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "처리하지 못했습니다." });
    } finally {
      setBusy("");
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function toggleRecording() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        void submitAudio(new Blob(chunks, { type: rec.mimeType }));
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
      setMessage(null);
    } catch {
      setMessage({ ok: false, text: "마이크를 쓸 수 없습니다. 브라우저의 마이크 권한을 확인해 주세요." });
    }
  }

  const on = helper === "on";
  return (
    <section className="rounded border border-slate-200 bg-white p-4">
      <h2 className="mb-2 text-lg font-semibold">새로 넣기</h2>
      <label htmlFor="intake-text" className="mb-1 block text-sm font-medium">
        들은 말이나 받은 글
      </label>
      <textarea
        id="intake-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="예: 나사 두 박스 반 남았고, 1호기 건은 다음 주 화요일로 당겨졌어요"
        className={inputClass}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={submitText} disabled={Boolean(busy) || recording} className={primary}>
          글 정리해서 올리기
        </button>
        <button type="button" onClick={toggleRecording} disabled={Boolean(busy) || helper === "checking"} className={button}>
          {recording ? "■ 녹음 끝내고 올리기" : "● 녹음하기"}
        </button>
        <label className={`${button} ${busy || recording || helper === "checking" ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
          녹음 파일 올리기
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,.m4a,.3gp"
            className="sr-only"
            disabled={Boolean(busy) || recording || helper === "checking"}
            onChange={(e) => e.target.files?.[0] && void submitAudio(e.target.files[0])}
          />
        </label>
        {on && (
          <label className="flex items-center gap-1 text-sm text-slate-600">
            <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} /> 글도 LLM으로 정리
          </label>
        )}
      </div>
      <p className={`mt-2 text-xs ${on ? "text-emerald-700" : "text-slate-500"}`}>
        {helper === "checking" && "PC 도우미를 찾는 중…"}
        {on && "PC 도우미 연결됨 — 녹음을 받아 적고(Whisper) LLM으로 정리합니다. 음성은 이 PC 밖으로 나가지 않습니다."}
        {helper === "off" &&
          "녹음은 이 브라우저 안에서 받아 적습니다(처음 한 번 모델 약 250MB를 내려받음). 음성은 이 기기 밖으로 나가지 않지만, PC 도우미를 켠 PC보다 덜 정확해서 항상 '확인 필요'로 올라옵니다."}
      </p>
      {busy && <p className="mt-2 text-sm text-slate-600">{busy}</p>}
      {message && <p className={`mt-2 text-sm ${message.ok ? "text-emerald-700" : "text-red-600"}`}>{message.text}</p>}
    </section>
  );
}

function IntakeCard({ row, items, planInput }: { row: IntakeRow; items: IntakeItems; planInput: PlanInput }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>(() => row.records.map(toDraft));
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const checked = useMemo(() => validateRecords(drafts.map(fromDraft), items), [drafts, items]);
  const materialNames = useMemo(() => new Map(items.materials.map((m) => [m.id, m.name])), [items]);
  const preview = useMemo(() => {
    if (checked.errors.length || checked.records.length === 0) return null;
    return diffOrders(calculatePlan(planInput).orders, calculatePlan(applyToPlanInput(planInput, checked.records)).orders);
  }, [checked, planInput]);

  const update = (i: number, patch: Partial<Draft>) => setDrafts((list) => list.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const act = (run: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      setError("");
      const result = await run();
      if (!result.ok) setError(result.message ?? "실패했습니다.");
      else router.refresh();
    });
  const orders = (list: { orderDate: string; orderQty: number }[]) => (list.length ? list.map((o) => `${formatDate(o.orderDate)} ${formatQty(o.orderQty)}`).join(", ") : "없음");

  return (
    <article className={`rounded border bg-white p-4 ${row.needs_review ? "border-amber-400" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="rounded bg-slate-100 px-2 py-0.5">{row.source === "audio" ? "녹음" : "글"}</span>
        <span>{methodLabel(row.method)}</span>
        <span>{when(row.created_at)}</span>
        {row.needs_review && <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-900">확인 필요</span>}
      </div>
      <p className="mt-2 rounded bg-slate-50 p-2 text-sm">“{row.original_text}”</p>
      {row.reasons.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm text-amber-900">
          {row.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}

      <h3 className="mt-3 text-sm font-medium">반영할 내용 — 원래 말과 맞는지 확인하고 고치세요</h3>
      <div className="mt-1 space-y-2">
        {drafts.length === 0 && <p className="text-sm text-slate-500">정리된 내용이 없습니다. 줄을 추가해서 직접 넣을 수 있습니다.</p>}
        {drafts.map((d, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select aria-label="종류" value={d.kind} onChange={(e) => update(i, { kind: e.target.value as Draft["kind"] })} className={`${inputClass} !w-28`}>
              <option value="stock_report">재고</option>
              <option value="schedule_change">일정 변경</option>
            </select>
            {d.kind === "stock_report" ? (
              <>
                <select aria-label="부자재" value={d.materialId} onChange={(e) => update(i, { materialId: e.target.value })} className={`${inputClass} !w-48`}>
                  <option value="">부자재 선택</option>
                  {items.materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.id})
                    </option>
                  ))}
                </select>
                <input aria-label="현재 재고 (낱개)" inputMode="decimal" placeholder="현재 재고 (낱개)" value={d.qty} onChange={(e) => update(i, { qty: e.target.value })} className={`${inputClass} !w-40`} />
              </>
            ) : (
              <>
                <select aria-label="프로젝트" value={d.projectId} onChange={(e) => update(i, { projectId: e.target.value })} className={`${inputClass} !w-48`}>
                  <option value="">프로젝트 선택</option>
                  {items.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input aria-label="생산시작일" type="date" value={d.startDate} onChange={(e) => update(i, { startDate: e.target.value })} className={`${inputClass} !w-40`} />
                <input aria-label="생산수량" inputMode="decimal" placeholder="생산수량 (바뀌면)" value={d.productionQty} onChange={(e) => update(i, { productionQty: e.target.value })} className={`${inputClass} !w-40`} />
              </>
            )}
            <button type="button" onClick={() => setDrafts((list) => list.filter((_, j) => j !== i))} className="text-xs text-red-700 underline">
              줄 삭제
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setDrafts((list) => [...list, EMPTY])} className="text-sm underline">
          + 줄 추가
        </button>
      </div>

      <div className="mt-3 rounded bg-slate-50 p-2 text-sm">
        <span className="font-medium">확정하면 달라지는 발주: </span>
        {checked.errors.length > 0 ? (
          <span className="text-red-600">{checked.errors.join(" ")}</span>
        ) : preview === null ? (
          <span className="text-slate-500">반영할 내용을 넣으면 보입니다.</span>
        ) : preview.length === 0 ? (
          <span className="text-slate-600">발주는 달라지지 않습니다.</span>
        ) : (
          <ul className="mt-1 list-disc pl-5">
            {preview.map((c) => (
              <li key={c.materialId}>
                {materialNames.get(c.materialId) ?? c.materialId} — {orders(c.before)} → {orders(c.after)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending || checked.errors.length > 0 || checked.records.length === 0} onClick={() => act(() => confirmIntake(row.id, drafts.map(fromDraft)))} className={primary}>
          {pending ? "처리 중…" : "확정 (재고·일정에 반영)"}
        </button>
        <button type="button" disabled={pending} onClick={() => act(() => discardIntake(row.id))} className={button}>
          버리기
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </article>
  );
}

function History({ rows, items }: { rows: IntakeRow[]; items: IntakeItems }) {
  const materialNames = new Map(items.materials.map((m) => [m.id, m.name]));
  const projectNames = new Map(items.projects.map((p) => [p.id, p.name]));
  const describe = (r: NonNullable<IntakeRow["applied"]>[number]) => {
    if (r.kind === "stock_report") {
      const before = r.before?.stockQty;
      return `${materialNames.get(r.materialId) ?? r.materialId} 재고 ${before === undefined ? "" : `${formatQty(Number(before))} → `}${formatQty(r.qty)}`;
    }
    const parts = [];
    if (r.startDate) parts.push(`시작일 ${r.before?.startDate ? `${formatDate(String(r.before.startDate))} → ` : ""}${formatDate(r.startDate)}`);
    if (r.productionQty !== undefined) parts.push(`수량 ${r.before?.productionQty === undefined ? "" : `${formatQty(Number(r.before.productionQty))} → `}${formatQty(r.productionQty)}`);
    return `${projectNames.get(r.projectId) ?? "프로젝트"} ${parts.join(", ")}`;
  };

  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold">처리한 것 (최근 {rows.length}건)</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">아직 없습니다.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-3 py-2">처리</th>
                <th className="px-3 py-2">원래 말</th>
                <th className="px-3 py-2">반영한 내용</th>
                <th className="px-3 py-2">언제</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 align-top last:border-0">
                  <td className="whitespace-nowrap px-3 py-2">{row.status === "confirmed" ? "확정" : "버림"}</td>
                  <td className="px-3 py-2">{row.original_text}</td>
                  <td className="px-3 py-2">{row.status === "confirmed" ? (row.applied ?? []).map(describe).join(" / ") : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-500">{row.decided_at ? when(row.decided_at) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
