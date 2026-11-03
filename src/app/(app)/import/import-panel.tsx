"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/form";
import { formatQty } from "@/lib/dates";
import { COLUMNS, type ImportKind, type ImportRow } from "@/lib/import/sheet";
import { applyImport, previewImport, type ImportState } from "./actions";

const IDLE: ImportState = { status: "idle" };
const PREVIEW_LIMIT = 200;

export function ImportPanel({ kind }: { kind: ImportKind }) {
  const [preview, previewAction] = useActionState(previewImport, IDLE);
  const [applied, applyAction] = useActionState(applyImport, IDLE);

  // 적용을 시도했으면 그 결과(재검사 결과 포함)를, 아니면 미리보기를 보여준다
  const current = applied.status !== "idle" && applied.kind === kind ? applied : preview;
  const result = current.status === "preview" ? current.result : undefined;
  const canApply = result && result.errors.length === 0 && result.rows.length > 0;

  return (
    <div className="space-y-4">
      <form action={previewAction} className="flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-white p-4">
        <input type="hidden" name="kind" value={kind} />
        <input
          type="file"
          name="file"
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          required
          className="text-sm file:mr-3 file:rounded file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5"
        />
        <SubmitButton>미리보기</SubmitButton>
        <a href={`/api/import/template/${kind}`} className="ml-auto text-sm text-slate-600 underline">
          양식 내려받기 (현재 데이터 포함)
        </a>
      </form>

      {current.message && (
        <p className={`rounded p-3 text-sm ${current.status === "done" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
          {current.message}
        </p>
      )}

      {result && (
        <section className="space-y-3 rounded border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="font-semibold">{current.fileName}</span>
            <span>정상 {result.rows.length}행</span>
            <span>(신규 {result.rows.filter((r) => r.action === "create").length} · 변경 {result.rows.filter((r) => r.action === "update").length})</span>
            <span className={result.errors.length > 0 ? "font-semibold text-red-700" : "text-slate-500"}>오류 {result.errors.length}건</span>
            {canApply && (
              <form action={applyAction} className="ml-auto">
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="table" value={JSON.stringify(current.table)} />
                <SubmitButton className="rounded bg-emerald-700 px-4 py-1.5 text-sm text-white disabled:opacity-50">{result.rows.length}행 반영하기</SubmitButton>
              </form>
            )}
          </div>

          {result.errors.length > 0 && (
            <div className="rounded bg-red-50 p-3 text-sm text-red-800">
              <p className="mb-1 font-semibold">오류가 있으면 아무것도 반영하지 않습니다. 파일을 고쳐서 다시 올려 주세요.</p>
              <ul className="max-h-60 list-disc overflow-auto pl-5">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    {e.row}행: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {kind === "bom" && result.rows.length > 0 && (
            <p className="text-sm text-amber-800">
              파일에 있는 제품 {new Set(result.rows.map((r) => (r.kind === "bom" ? r.data.product_id : ""))).size}개의 BOM은 파일 내용으로 바뀝니다. 파일에
              없는 부자재 줄은 지워집니다.
            </p>
          )}

          <PreviewTable kind={kind} rows={result.rows.slice(0, PREVIEW_LIMIT)} />
          {result.rows.length > PREVIEW_LIMIT && <p className="text-xs text-slate-500">처음 {PREVIEW_LIMIT}행만 보여줍니다.</p>}
        </section>
      )}
    </div>
  );
}

function PreviewTable({ kind, rows }: { kind: ImportKind; rows: ImportRow[] }) {
  if (rows.length === 0) return null;
  const columns = COLUMNS[kind];
  const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "number" ? formatQty(v) : String(v));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-300 text-left text-slate-500">
            <th className="p-1.5">행</th>
            <th className="p-1.5">구분</th>
            {columns.map((c) => (
              <th key={c.key} className="p-1.5">
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const data = r.data as Record<string, unknown>;
            return (
              <tr key={r.row} className="border-b border-slate-100">
                <td className="p-1.5 text-slate-500">{r.row}</td>
                <td className="p-1.5">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${r.action === "create" ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-700"}`}>
                    {r.action === "create" ? "신규" : "변경"}
                  </span>
                </td>
                {columns.map((c) => (
                  <td key={c.key} className="p-1.5">
                    {show(data[c.key])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
