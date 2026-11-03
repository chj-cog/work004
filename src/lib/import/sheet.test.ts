import { describe, expect, it } from "vitest";
import { decodeCsv, normalizeHeader, parseCsv, parseTable, type ImportContext } from "./sheet";

const ctx: ImportContext = { materialIds: new Set(["A", "B"]), productIds: new Set(["X"]) };

describe("열 제목", () => {
  it("공백·괄호·대소문자 차이를 무시한다", () => {
    expect(normalizeHeader("리드타임 (영업일)")).toBe("리드타임");
    expect(normalizeHeader("최소 발주수량(MOQ)")).toBe("최소발주수량");
    expect(normalizeHeader("MOQ")).toBe("moq");
  });

  it("필수 열이 없으면 행 하나짜리 오류", () => {
    const { rows, errors } = parseTable("materials", [["코드", "이름"], ["A", "나사"]], ctx);
    expect(rows).toEqual([]);
    expect(errors).toEqual([{ row: 1, message: expect.stringContaining("발주 단위, 리드타임(영업일)") }]);
  });
});

describe("부자재", () => {
  const header = ["부자재 코드", "품명", "단위", "발주단위", "MOQ", "리드타임", "재고"];

  it("다른 이름의 열 제목도 받고, 신규/변경을 구분한다", () => {
    const { rows, errors } = parseTable(
      "materials",
      [header, ["A", "나사", "개", "1,500", "", "6", "500"], ["N", "새 부자재", "", "800", "2000", "10", ""]],
      ctx,
    );
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.row, r.action])).toEqual([
      [2, "update"],
      [3, "create"],
    ]);
    expect(rows[1]!.data).toMatchObject({ id: "N", unit: "개", order_unit: 800, moq: 2000, lead_time_bdays: 10, stock_qty: 0 });
  });

  it("행별 오류와 코드 중복", () => {
    const { rows, errors } = parseTable(
      "materials",
      [header, ["A", "나사", "", "0", "", "6", ""], ["C", "라벨", "", "100", "", "3", ""], ["C", "라벨2", "", "100", "", "3", ""]],
      ctx,
    );
    expect(rows).toHaveLength(1);
    expect(errors.map((e) => e.row)).toEqual([2, 4]);
    expect(errors[1]!.message).toContain("3행과 중복");
  });

  it("빈 행은 건너뛴다", () => {
    const { rows } = parseTable("materials", [[], header, ["", "", "", "", "", "", ""], ["A", "나사", "", "800", "", "6", "1"]], ctx);
    expect(rows.map((r) => r.row)).toEqual([4]);
  });
});

describe("제품·BOM", () => {
  const header = ["제품 코드", "제품명", "부자재 코드", "소요량"];

  it("등록되지 않은 부자재, 제품명 불일치, 중복 줄을 잡는다", () => {
    const { rows, errors } = parseTable(
      "bom",
      [
        header,
        ["X", "제품 X", "A", "17"],
        ["X", "제품 X", "B", "13"],
        ["X", "다른 이름", "B", "1"],
        ["Y", "제품 Y", "Z", "1"],
        ["Y", "제품 Y", "A", "9"],
        ["Y", "제품 Y", "A", "9"],
      ],
      ctx,
    );
    expect(rows.map((r) => [r.row, r.action])).toEqual([
      [2, "update"],
      [3, "update"],
      [6, "create"],
    ]);
    expect(errors.map((e) => e.row)).toEqual([4, 5, 7]);
  });
});

describe("재고", () => {
  it("등록된 부자재만 바꾼다", () => {
    const { rows, errors } = parseTable("stock", [["코드", "현재 재고"], ["A", "1,200"], ["Q", "5"], ["B", "-1"]], ctx);
    expect(rows).toEqual([{ kind: "stock", row: 2, action: "update", data: { id: "A", stock_qty: 1200 } }]);
    expect(errors.map((e) => e.row)).toEqual([3, 4]);
  });
});

describe("CSV", () => {
  it("따옴표 안의 쉼표와 줄바꿈", () => {
    expect(parseCsv('코드,이름\r\nA,"나사, 6각"\nB,"두 줄\n이름"\n')).toEqual([
      ["코드", "이름"],
      ["A", "나사, 6각"],
      ["B", "두 줄\n이름"],
    ]);
  });

  it("UTF-8 BOM과 EUC-KR", () => {
    const utf8 = new TextEncoder().encode("﻿코드\nA");
    expect(parseCsv(decodeCsv(utf8))).toEqual([["코드"], ["A"]]);
    // "코드" in EUC-KR
    const eucKr = new Uint8Array([0xc4, 0xda, 0xb5, 0xe5]);
    expect(decodeCsv(eucKr)).toBe("코드");
  });
});
