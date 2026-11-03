/**
 * 엑셀·CSV 가져오기: 표(문자열 2차원 배열) → 검사된 행. 파일 읽기와 DB는 다루지 않는다.
 * 미리보기와 적용이 같은 함수를 거치므로, 적용 시점에 다시 검사한다.
 */
import { CODE_RE, parseBomItem, parseMaterial, parseProduct, toNumber, type MaterialInput } from "@/lib/validation";

export type ImportKind = "materials" | "bom" | "stock";

export const IMPORT_KINDS: { kind: ImportKind; label: string; description: string }[] = [
  { kind: "materials", label: "부자재", description: "부자재 목록을 추가하거나 고칩니다. 코드가 같으면 덮어씁니다." },
  { kind: "bom", label: "제품·BOM", description: "제품과 BOM을 넣습니다. 파일에 있는 제품의 BOM은 파일 내용으로 바뀝니다." },
  { kind: "stock", label: "재고", description: "등록된 부자재의 현재 재고만 바꿉니다." },
];

export interface ColumnSpec {
  key: string;
  title: string;
  required: boolean;
  aliases: string[];
}

export const COLUMNS: Record<ImportKind, ColumnSpec[]> = {
  materials: [
    { key: "id", title: "코드", required: true, aliases: ["부자재코드", "자재코드", "품번"] },
    { key: "name", title: "이름", required: true, aliases: ["부자재명", "자재명", "품명"] },
    { key: "unit", title: "단위", required: false, aliases: [] },
    { key: "order_unit", title: "발주 단위", required: true, aliases: ["발주단위수량"] },
    { key: "moq", title: "최소 발주수량(MOQ)", required: false, aliases: ["moq"] },
    { key: "lead_time_bdays", title: "리드타임(영업일)", required: true, aliases: ["lt", "leadtime"] },
    { key: "stock_qty", title: "현재 재고", required: false, aliases: ["재고", "재고수량"] },
  ],
  bom: [
    { key: "product_id", title: "제품 코드", required: true, aliases: [] },
    { key: "product_name", title: "제품명", required: true, aliases: ["제품이름"] },
    { key: "material_id", title: "부자재 코드", required: true, aliases: ["자재코드", "품번"] },
    { key: "qty_per_unit", title: "소요량", required: true, aliases: ["제품당소요량", "제품1개당소요량"] },
  ],
  stock: [
    { key: "id", title: "부자재 코드", required: true, aliases: ["코드", "자재코드", "품번"] },
    { key: "stock_qty", title: "현재 재고", required: true, aliases: ["재고", "재고수량"] },
  ],
};

export const MAX_ROWS = 2000;

/** "리드타임 (영업일)", "발주_단위", "MOQ" 등 표기 차이를 없앤다 */
export function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[\s_\-·./]/g, "");
}

export interface ImportContext {
  materialIds: Set<string>;
  productIds: Set<string>;
}

export interface RowError {
  /** 엑셀 행 번호 (1부터) */
  row: number;
  message: string;
}

export type ImportRow =
  | { kind: "materials"; row: number; action: "create" | "update"; data: MaterialInput }
  | { kind: "bom"; row: number; action: "create" | "update"; data: { product_id: string; product_name: string; material_id: string; qty_per_unit: number } }
  | { kind: "stock"; row: number; action: "update"; data: { id: string; stock_qty: number } };

export interface ImportResult {
  rows: ImportRow[];
  errors: RowError[];
}

export function parseTable(kind: ImportKind, table: string[][], ctx: ImportContext): ImportResult {
  const errors: RowError[] = [];
  const headerIndex = table.findIndex((r) => r.some((c) => c.trim() !== ""));
  if (headerIndex === -1) return { rows: [], errors: [{ row: 1, message: "파일에 내용이 없습니다." }] };

  // 열 찾기
  const header = table[headerIndex]!.map(normalizeHeader);
  const columnIndex = new Map<string, number>();
  const missing: string[] = [];
  for (const spec of COLUMNS[kind]) {
    const names = [spec.title, ...spec.aliases].map(normalizeHeader);
    const idx = header.findIndex((h) => h !== "" && names.includes(h));
    if (idx >= 0) columnIndex.set(spec.key, idx);
    else if (spec.required) missing.push(spec.title);
  }
  if (missing.length > 0) {
    return { rows: [], errors: [{ row: headerIndex + 1, message: `필수 열이 없습니다: ${missing.join(", ")}. 양식의 첫 행(제목)을 확인하세요.` }] };
  }

  const body = table
    .map((cells, i) => ({ row: i + 1, cells }))
    .slice(headerIndex + 1)
    .filter(({ cells }) => cells.some((c) => c.trim() !== ""));
  if (body.length === 0) return { rows: [], errors: [{ row: headerIndex + 2, message: "제목 아래에 데이터가 없습니다." }] };
  if (body.length > MAX_ROWS) return { rows: [], errors: [{ row: headerIndex + 2, message: `한 번에 ${MAX_ROWS}행까지 가져올 수 있습니다 (지금 ${body.length}행).` }] };

  const rows: ImportRow[] = [];
  const seen = new Map<string, number>();
  const productNames = new Map<string, string>();

  for (const { row, cells } of body) {
    const values = new Map<string, string>();
    for (const [key, idx] of columnIndex) values.set(key, (cells[idx] ?? "").trim());
    const fail = (message: string) => errors.push({ row, message });
    const duplicate = (key: string, label: string) => {
      const first = seen.get(key);
      if (first !== undefined) {
        fail(`${label}이(가) ${first}행과 중복됩니다.`);
        return true;
      }
      seen.set(key, row);
      return false;
    };

    if (kind === "materials") {
      const parsed = parseMaterial(values);
      if (!parsed.data) {
        Object.values(parsed.errors).forEach(fail);
        continue;
      }
      if (duplicate(parsed.data.id, `코드 ${parsed.data.id}`)) continue;
      rows.push({ kind, row, action: ctx.materialIds.has(parsed.data.id) ? "update" : "create", data: parsed.data });
    } else if (kind === "bom") {
      const product = parseProduct(new Map([["id", values.get("product_id") ?? ""], ["name", values.get("product_name") ?? ""]]));
      const item = parseBomItem(values);
      const rowErrors = [...Object.values(product.errors ?? {}), ...Object.values(item.errors ?? {})];
      if (item.data && !ctx.materialIds.has(item.data.material_id)) {
        rowErrors.push(`부자재 코드 ${item.data.material_id}이(가) 등록되어 있지 않습니다. 부자재를 먼저 가져오세요.`);
      }
      if (product.data) {
        const prevName = productNames.get(product.data.id);
        if (prevName !== undefined && prevName !== product.data.name) {
          rowErrors.push(`제품 ${product.data.id}의 제품명이 앞 행(${prevName})과 다릅니다.`);
        }
      }
      if (rowErrors.length > 0 || !product.data || !item.data) {
        rowErrors.forEach(fail);
        continue;
      }
      productNames.set(product.data.id, product.data.name);
      if (duplicate(`${product.data.id}\u0000${item.data.material_id}`, `제품 ${product.data.id}의 부자재 ${item.data.material_id}`)) continue;
      rows.push({
        kind,
        row,
        action: ctx.productIds.has(product.data.id) ? "update" : "create",
        data: { product_id: product.data.id, product_name: product.data.name, ...item.data },
      });
    } else {
      const id = values.get("id") ?? "";
      const stock = toNumber(values.get("stock_qty") ?? "");
      if (!CODE_RE.test(id)) {
        fail("부자재 코드가 비어 있거나 올바르지 않습니다.");
        continue;
      }
      if (!ctx.materialIds.has(id)) {
        fail(`부자재 코드 ${id}이(가) 등록되어 있지 않습니다. 재고 가져오기는 등록된 부자재만 바꿉니다.`);
        continue;
      }
      if (stock === null || !(stock >= 0)) {
        fail("현재 재고는 0 이상의 숫자여야 합니다.");
        continue;
      }
      if (duplicate(id, `코드 ${id}`)) continue;
      rows.push({ kind, row, action: "update", data: { id, stock_qty: stock } });
    }
  }

  return { rows, errors };
}

/** 엑셀 셀 값 → 문자열 */
export function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/** 간단한 CSV 해석 (따옴표, 따옴표 안 쉼표·줄바꿈 지원) */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** 한국어 엑셀이 저장한 CSV는 CP949(EUC-KR)인 경우가 많다. UTF-8이 아니면 EUC-KR로 읽는다 */
export function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("euc-kr").decode(bytes);
  }
}
