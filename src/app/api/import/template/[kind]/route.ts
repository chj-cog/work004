import writeXlsxFile, { type SheetData } from "write-excel-file/node";
import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { COLUMNS, IMPORT_KINDS, type ImportKind } from "@/lib/import/sheet";
import { createClient } from "@/lib/supabase/server";

const EXAMPLES: Record<ImportKind, (string | number)[][]> = {
  materials: [
    ["A", "나사", "개", 800, "", 6, 500],
    ["D", "완충재", "개", 500, 2000, 6, 0],
  ],
  bom: [
    ["X", "제품 X", "A", 17],
    ["X", "제품 X", "D", 7],
  ],
  stock: [["A", 500]],
};

/** 양식 내려받기. 등록된 데이터가 있으면 그 값을 채워서 준다 (고쳐서 다시 올리기 쉽게) */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  await requireUser();
  const kind = (await params).kind as ImportKind;
  const meta = IMPORT_KINDS.find((k) => k.kind === kind);
  if (!meta) return new Response("Not found", { status: 404 });

  const supabase = await createClient();
  let body: (string | number)[][] = [];
  if (kind === "materials" || kind === "stock") {
    const { data } = await supabase.from("materials").select("id, name, unit, order_unit, moq, lead_time_bdays, stock_qty").order("id");
    body = (data ?? []).map((m) =>
      kind === "materials"
        ? [m.id, m.name, m.unit, Number(m.order_unit), m.moq === null ? "" : Number(m.moq), m.lead_time_bdays, Number(m.stock_qty)]
        : [m.id, Number(m.stock_qty)],
    );
  } else {
    const { data } = await supabase
      .from("bom_items")
      .select("product_id, material_id, qty_per_unit, products(name)")
      .order("product_id")
      .returns<{ product_id: string; material_id: string; qty_per_unit: number; products: { name: string } | null }[]>();
    body = (data ?? []).map((b) => [b.product_id, b.products?.name ?? "", b.material_id, Number(b.qty_per_unit)]);
  }
  if (body.length === 0) body = EXAMPLES[kind];

  const sheet: SheetData = [
    COLUMNS[kind].map((c) => ({ value: c.title, fontWeight: "bold" as const })),
    ...body.map((row) => row.map((v) => (v === "" ? null : v))),
  ];
  const buffer = await writeXlsxFile(sheet, {
    sheet: meta.label,
    columns: COLUMNS[kind].map((c) => ({ width: Math.max(12, c.title.length * 2 + 4) })),
    stickyRowsCount: 1,
  }).toBuffer();

  const fileName = encodeURIComponent(`${meta.label}_양식.xlsx`);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="template.xlsx"; filename*=UTF-8''${fileName}`,
      "Cache-Control": "no-store",
    },
  });
}
