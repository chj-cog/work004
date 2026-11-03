/** 'YYYY-MM-DD' 형식의 날짜 */
export type ISODate = string;

export interface Material {
  id: string;
  name: string;
  /** 발주 단위 (예: 800). 발주수량은 항상 이 값의 배수 */
  orderUnit: number;
  /** 최소 발주수량. 없으면 null */
  moq: number | null;
  /** 리드타임 (영업일) */
  leadTimeBdays: number;
  /** 현재 실재고 */
  stockQty: number;
}

export interface BomItem {
  productId: string;
  materialId: string;
  /** 제품 1개당 소요량 */
  qtyPerUnit: number;
}

export type ProjectStatus = "planned" | "in_progress" | "done" | "cancelled";

export interface Project {
  id: string;
  name: string;
  productId: string;
  productionQty: number;
  startDate: ISODate;
  status: ProjectStatus;
}

/** 발주 완료했지만 아직 입고되지 않은 발주. 입고 예정 재고로 취급한다 */
export interface OpenOrder {
  materialId: string;
  qty: number;
}

export interface Settings {
  /** 여유일: 생산시작일 몇 영업일 전까지 입고되어야 하는가 */
  bufferBdays: number;
  /** 임박 기준: 오늘부터 몇 영업일 이내 발주일이면 임박인가 */
  imminentBdays: number;
  /** 발주일 간격이 이 영업일 수 이내인 같은 부자재 발주는 합친다 */
  mergeWindowBdays: number;
}

export const DEFAULT_SETTINGS: Settings = {
  bufferBdays: 3,
  imminentBdays: 3,
  mergeWindowBdays: 5,
};

export interface PlanInput {
  today: ISODate;
  materials: Material[];
  bomItems: BomItem[];
  projects: Project[];
  openOrders?: OpenOrder[];
  /** 공휴일 + 회사 휴무일 */
  holidays: ISODate[];
  /** 휴일 데이터를 받아 둔 연도. 주면 계산에 쓰인 연도 중 빠진 해를 경고한다 */
  holidayYears?: number[];
  settings?: Partial<Settings>;
}

/** 지남 / 임박 / 예정 */
export type OrderStatus = "overdue" | "imminent" | "scheduled";

export interface Allocation {
  projectId: string;
  requiredQty: number;
  /** 기존 재고·입고 예정·앞 발주의 남은 수량에서 배정된 수량 */
  fromStockQty: number;
  /** 이 발주에서 배정된 수량 */
  fromOrderQty: number;
}

/** 체크리스트의 한 줄 = 한 번의 발주 */
export interface PlannedOrder {
  materialId: string;
  orderDate: ISODate;
  orderQty: number;
  expectedArrivalDate: ISODate;
  /** 이 발주로 묶인 프로젝트를 모두 소진한 뒤 잔여재고 */
  remainingAfterQty: number;
  /** MOQ 때문에 발주수량이 늘었는가 */
  moqApplied: boolean;
  status: OrderStatus;
  projectIds: string[];
  allocations: Allocation[];
  /** 지남일 때만: 오늘 발주하면 입고되는 날 */
  arrivalIfOrderedToday: ISODate | null;
  /** 지금 발주해도 생산시작일 전에 입고되지 못함 */
  delayRisk: boolean;
}

export type IssueCode =
  | "BOM_MISSING"
  | "UNKNOWN_MATERIAL"
  | "INVALID_ORDER_UNIT"
  | "INVALID_LEAD_TIME"
  | "INVALID_MOQ"
  | "INVALID_STOCK"
  | "INVALID_PRODUCTION_QTY"
  | "INVALID_DATE"
  | "START_ON_HOLIDAY"
  | "HOLIDAYS_MISSING";

export interface Issue {
  level: "error" | "warning";
  code: IssueCode;
  message: string;
  materialId?: string;
  projectId?: string;
}

export interface PlanResult {
  /** 체크리스트 순서: 지남 → 임박 → 예정, 같은 상태 안에서는 발주일 순 */
  orders: PlannedOrder[];
  issues: Issue[];
}
