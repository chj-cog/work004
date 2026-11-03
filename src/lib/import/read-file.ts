import "server-only";
import { readSheet } from "read-excel-file/node";
import { cellToString, decodeCsv, parseCsv } from "./sheet";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** 업로드한 .xlsx 또는 .csv의 첫 시트를 문자열 표로 읽는다 */
export async function readUploadedTable(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (file.size === 0) throw new Error("빈 파일입니다.");
  if (file.size > MAX_FILE_BYTES) throw new Error("파일이 너무 큽니다 (2MB까지).");

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (name.endsWith(".csv")) return parseCsv(decodeCsv(bytes));
  if (name.endsWith(".xls")) throw new Error("예전 엑셀 형식(.xls)은 읽을 수 없습니다. 엑셀에서 '다른 이름으로 저장 → Excel 통합 문서(.xlsx)'로 저장해 주세요.");
  if (!name.endsWith(".xlsx")) throw new Error(".xlsx 또는 .csv 파일을 올려 주세요.");

  try {
    const data = await readSheet(Buffer.from(bytes));
    return data.map((row) => row.map(cellToString));
  } catch {
    throw new Error("엑셀 파일을 읽지 못했습니다. 파일이 손상되었거나 암호가 걸려 있는지 확인해 주세요.");
  }
}
