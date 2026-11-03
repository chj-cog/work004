import { describe, expect, it } from "vitest";
import { createCalendar, isValidISODate } from "./calendar";

describe("영업일 달력", () => {
  const cal = createCalendar(["2026-11-12", "2026-11-13"]);

  it("주말과 휴일은 영업일이 아니다", () => {
    expect(cal.isBusinessDay("2026-11-03")).toBe(true); // 화
    expect(cal.isBusinessDay("2026-11-07")).toBe(false); // 토
    expect(cal.isBusinessDay("2026-11-08")).toBe(false); // 일
    expect(cal.isBusinessDay("2026-11-12")).toBe(false); // 휴일
  });

  it("영업일 빼기·더하기는 주말과 휴일을 건너뛴다", () => {
    const plain = createCalendar([]);
    expect(plain.subtractBusinessDays("2026-11-20", 3)).toBe("2026-11-17");
    expect(plain.subtractBusinessDays("2026-11-17", 6)).toBe("2026-11-09");
    expect(plain.addBusinessDays("2026-11-09", 6)).toBe("2026-11-17");
    expect(cal.subtractBusinessDays("2026-11-20", 9)).toBe("2026-11-05");
    expect(cal.addBusinessDays("2026-11-05", 6)).toBe("2026-11-17");
    expect(cal.addBusinessDays("2026-11-07", 1)).toBe("2026-11-09"); // 토요일에서 1영업일 뒤 = 월
    expect(plain.subtractBusinessDays("2026-11-03", 0)).toBe("2026-11-03");
  });

  it("영업일 간격은 시작일 다음 날부터 센다", () => {
    expect(cal.businessDaysBetween("2026-11-09", "2026-11-11")).toBe(2);
    expect(cal.businessDaysBetween("2026-11-11", "2026-11-16")).toBe(1); // 12·13 휴일, 14·15 주말
    expect(cal.businessDaysBetween("2026-11-11", "2026-11-09")).toBe(-2);
    expect(cal.businessDaysBetween("2026-11-09", "2026-11-09")).toBe(0);
  });

  it("직전 영업일", () => {
    expect(cal.previousBusinessDay("2026-11-21")).toBe("2026-11-20"); // 토 → 금
    expect(cal.previousBusinessDay("2026-11-15")).toBe("2026-11-11"); // 일 → 휴일·주말 건너 수
    expect(cal.previousBusinessDay("2026-11-10")).toBe("2026-11-10");
  });

  it("월·연도 경계를 넘는다", () => {
    const plain = createCalendar([]);
    expect(plain.addBusinessDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(plain.subtractBusinessDays("2026-12-01", 1)).toBe("2026-11-30");
  });

  it("날짜 형식 검사", () => {
    expect(isValidISODate("2026-11-03")).toBe(true);
    expect(isValidISODate("2026-02-30")).toBe(false);
    expect(isValidISODate("2026/11/03")).toBe(false);
  });
});
