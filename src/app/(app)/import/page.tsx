import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { COLUMNS, IMPORT_KINDS, type ImportKind } from "@/lib/import/sheet";
import { PageHeader } from "@/components/placeholder";
import { ImportPanel } from "./import-panel";

export const metadata = { title: "엑셀 가져오기" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  await requireUser();
  const requested = (await searchParams).kind;
  const kind: ImportKind = IMPORT_KINDS.some((k) => k.kind === requested) ? (requested as ImportKind) : "materials";
  const meta = IMPORT_KINDS.find((k) => k.kind === kind)!;

  return (
    <div className="space-y-4">
      <PageHeader title="엑셀 가져오기" description="지금 쓰는 엑셀을 그대로 옮겨옵니다. 올린 파일은 먼저 검사해서 보여주고, 확인한 뒤에 반영합니다." />

      <nav className="flex gap-2 text-sm">
        {IMPORT_KINDS.map((k) => (
          <Link
            key={k.kind}
            href={`/import?kind=${k.kind}`}
            className={`rounded px-3 py-1.5 ${k.kind === kind ? "bg-slate-900 text-white" : "border border-slate-300 bg-white"}`}
          >
            {k.label}
          </Link>
        ))}
      </nav>

      <div className="rounded border border-slate-200 bg-white p-4 text-sm">
        <p>{meta.description}</p>
        <p className="mt-2 text-slate-600">
          첫 행은 열 제목입니다. 필요한 열:{" "}
          {COLUMNS[kind].map((c, i) => (
            <span key={c.key}>
              {i > 0 && ", "}
              <b className={c.required ? "" : "font-normal"}>{c.title}</b>
              {!c.required && " (선택)"}
            </span>
          ))}
          . 열 순서는 달라도 되고, 다른 열이 있어도 무시합니다. .xlsx는 첫 번째 시트를 읽습니다.
        </p>
        {kind === "bom" && <p className="mt-2 text-slate-600">한 행이 BOM 한 줄입니다. 부자재는 먼저 등록되어 있어야 합니다.</p>}
      </div>

      <ImportPanel key={kind} kind={kind} />
    </div>
  );
}
