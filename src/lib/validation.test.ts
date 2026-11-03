import { describe, expect, it } from "vitest";
import { invalid, parseBomItem, parseHoliday, parseMaterial, parseProject, parseSettings, parseSignIn, parseSignUp } from "./validation";

const form = (values: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
};

describe("부자재 입력", () => {
  const valid = { id: "A-01", name: "나사", unit: "개", order_unit: "1,500", moq: "", lead_time_bdays: "6", stock_qty: "500" };

  it("쉼표 숫자와 빈 MOQ를 받는다", () => {
    expect(parseMaterial(form(valid)).data).toEqual({
      id: "A-01",
      name: "나사",
      unit: "개",
      order_unit: 1500,
      moq: null,
      lead_time_bdays: 6,
      stock_qty: 500,
    });
  });

  it("단위를 비우면 '개'", () => {
    expect(parseMaterial(form({ ...valid, unit: "" })).data?.unit).toBe("개");
  });

  it("잘못된 값은 필드별 오류", () => {
    const { errors } = parseMaterial(form({ ...valid, id: "A 01", order_unit: "0", lead_time_bdays: "2.5", moq: "-1", stock_qty: "abc" }));
    expect(Object.keys(errors ?? {}).sort()).toEqual(["id", "lead_time_bdays", "moq", "order_unit", "stock_qty"]);
  });
});

describe("프로젝트 입력", () => {
  it("정상 입력", () => {
    const { data } = parseProject(form({ name: "P1", product_id: "X", production_qty: "100", start_date: "2026-11-20", status: "planned" }));
    expect(data).toEqual({ name: "P1", product_id: "X", production_qty: 100, start_date: "2026-11-20", status: "planned" });
  });

  it("없는 날짜와 잘못된 상태", () => {
    const { errors } = parseProject(form({ name: "P1", product_id: "X", production_qty: "100", start_date: "2026-02-30", status: "deleted" }));
    expect(Object.keys(errors ?? {}).sort()).toEqual(["start_date", "status"]);
  });
});

describe("로그인·회원가입", () => {
  it("이메일은 소문자로 바꾸고 앞뒤 공백을 없앤다", () => {
    expect(parseSignIn(form({ email: " Kim@Example.com ", password: "x" })).data).toEqual({ email: "kim@example.com", password: "x" });
  });

  it("비밀번호 길이와 확인 불일치", () => {
    const short = parseSignUp(form({ name: "김", email: "a@b.co", password: "1234567", password_confirm: "1234567" }));
    expect(short.errors).toHaveProperty("password");
    const mismatch = parseSignUp(form({ name: "김", email: "a@b.co", password: "12345678", password_confirm: "12345679" }));
    expect(mismatch.errors).toEqual({ password_confirm: expect.any(String) });
  });

  it("실패해도 비밀번호는 입력값으로 되돌려 보내지 않는다", () => {
    const state = invalid({ email: "x" }, form({ email: "a", password: "secret123", password_confirm: "secret123" }));
    expect(state.values).toEqual({ email: "a" });
  });
});

describe("기타 입력", () => {
  it("BOM 소요량은 소수 허용, 0은 거부", () => {
    expect(parseBomItem(form({ material_id: "A", qty_per_unit: "0.25" })).data?.qty_per_unit).toBe(0.25);
    expect(parseBomItem(form({ material_id: "A", qty_per_unit: "0" })).errors).toHaveProperty("qty_per_unit");
  });

  it("설정 범위", () => {
    expect(parseSettings(form({ buffer_bdays: "3", imminent_bdays: "3", merge_window_bdays: "5" })).data).toEqual({
      buffer_bdays: 3,
      imminent_bdays: 3,
      merge_window_bdays: 5,
    });
    expect(parseSettings(form({ buffer_bdays: "11", imminent_bdays: "3", merge_window_bdays: "5" })).errors).toHaveProperty("buffer_bdays");
  });

  it("회사 휴무일", () => {
    expect(parseHoliday(form({ date: "2026-08-03", name: "하계휴가" })).data).toEqual({ date: "2026-08-03", name: "하계휴가" });
    expect(parseHoliday(form({ date: "", name: "" })).errors).toEqual({ date: expect.any(String), name: expect.any(String) });
  });
});
