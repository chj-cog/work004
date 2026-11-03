"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded border border-slate-300 px-3 py-1.5 text-sm print:hidden">
      인쇄 (A4)
    </button>
  );
}
