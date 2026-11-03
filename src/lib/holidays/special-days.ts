/**
 * 공공데이터포털 「한국천문연구원_특일 정보」 공휴일 조회 (getRestDeInfo)
 * https://www.data.go.kr/data/15012690/openapi.do
 */
const ENDPOINT = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";

export interface PublicHoliday {
  date: string;
  name: string;
}

interface RawItem {
  locdate: number | string;
  dateName: string;
  isHoliday: string;
}

/** 응답 JSON → 공휴일 목록. 결과가 0건이면 items가 빈 문자열, 1건이면 배열이 아닌 객체로 온다 */
export function parseHolidayResponse(json: unknown): PublicHoliday[] {
  const response = (json as { response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: unknown } } })
    ?.response;
  const code = response?.header?.resultCode;
  if (code !== "00") throw new Error(`특일정보 API 오류: ${code ?? "응답 없음"} ${response?.header?.resultMsg ?? ""}`.trim());

  const items = response?.body?.items;
  if (!items || typeof items !== "object") return [];
  const item = (items as { item?: RawItem | RawItem[] }).item;
  const list = item === undefined ? [] : Array.isArray(item) ? item : [item];

  return list
    .filter((i) => i.isHoliday === "Y")
    .map((i) => {
      const d = String(i.locdate);
      return { date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, name: i.dateName };
    });
}

/** 한 해의 공휴일을 월별로 받아온다. 한 달이라도 실패하면 예외 (부분 데이터로 덮어쓰지 않도록) */
export async function fetchPublicHolidays(year: number, serviceKey: string): Promise<PublicHoliday[]> {
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
  const results = await Promise.all(
    months.map(async (month) => {
      const params = new URLSearchParams({ solYear: String(year), solMonth: month, ServiceKey: serviceKey, _type: "json", numOfRows: "50" });
      const res = await fetch(`${ENDPOINT}?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`특일정보 API HTTP ${res.status} (${year}-${month})`);
      return parseHolidayResponse(await res.json());
    }),
  );
  return results.flat();
}
