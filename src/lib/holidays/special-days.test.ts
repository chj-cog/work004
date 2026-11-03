import { describe, expect, it } from "vitest";
import { parseHolidayResponse } from "./special-days";

const wrap = (items: unknown, resultCode = "00") => ({
  response: { header: { resultCode, resultMsg: "NORMAL SERVICE." }, body: { items, totalCount: 0 } },
});

describe("특일정보 응답 해석", () => {
  it("여러 건은 배열로 온다", () => {
    const json = wrap({
      item: [
        { dateKind: "01", dateName: "추석", isHoliday: "Y", locdate: 20260925, seq: 1 },
        { dateKind: "01", dateName: "대체공휴일", isHoliday: "Y", locdate: 20260928, seq: 1 },
      ],
    });
    expect(parseHolidayResponse(json)).toEqual([
      { date: "2026-09-25", name: "추석" },
      { date: "2026-09-28", name: "대체공휴일" },
    ]);
  });

  it("한 건이면 객체로 온다", () => {
    const json = wrap({ item: { dateKind: "01", dateName: "기독탄신일", isHoliday: "Y", locdate: 20261225, seq: 1 } });
    expect(parseHolidayResponse(json)).toEqual([{ date: "2026-12-25", name: "기독탄신일" }]);
  });

  it("0건이면 items가 빈 문자열", () => {
    expect(parseHolidayResponse(wrap(""))).toEqual([]);
  });

  it("isHoliday가 N인 날은 뺀다", () => {
    const json = wrap({ item: { dateName: "제헌절", isHoliday: "N", locdate: 20260717 } });
    expect(parseHolidayResponse(json)).toEqual([]);
  });

  it("오류 코드면 예외", () => {
    expect(() => parseHolidayResponse(wrap("", "30"))).toThrow("30");
  });
});
