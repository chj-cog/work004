/** 입력 화면의 값 검사. 서버 액션에서 쓰며 DB 제약보다 먼저 사람이 읽을 수 있는 오류를 만든다 */
import { isValidISODate } from "@/engine/calendar";

export type FieldErrors = Record<string, string>;

export interface ActionState {
  status: "idle" | "ok" | "error";
  message?: string;
  errors?: FieldErrors;
  /** 실패 시 입력했던 값. 폼이 초기화되어도 다시 채운다 */
  values?: Record<string, string>;
}

export const IDLE: ActionState = { status: "idle" };

/** FormData 또는 엑셀 한 행(Map) */
export type Source = { get(key: string): unknown };

export type Parsed<T> = { data: T; errors: null } | { data: null; errors: FieldErrors };

function submittedValues(fd: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  // 비밀번호는 되돌려 보내지 않는다
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$") && !k.startsWith("password")) values[k] = v;
  return values;
}

export function invalid(errors: FieldErrors, fd: FormData): ActionState {
  return { status: "error", message: "입력값을 확인해 주세요.", errors, values: submittedValues(fd) };
}

export function failure(message: string, fd?: FormData): ActionState {
  return { status: "error", message, values: fd ? submittedValues(fd) : undefined };
}

const text = (fd: Source, key: string): string => String(fd.get(key) ?? "").trim();

/** "1,500" 같은 쉼표 표기도 받는다. 비어 있으면 null, 숫자가 아니면 NaN */
export function toNumber(value: string): number | null {
  const raw = value.trim().replaceAll(",", "");
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.NaN;
}

const number = (fd: Source, key: string): number | null => toNumber(text(fd, key));

export const CODE_RE = /^[^\s/?#%]{1,40}$/;

function finish<T>(data: T, errors: FieldErrors): Parsed<T> {
  return Object.keys(errors).length > 0 ? { data: null, errors } : { data, errors: null };
}

export interface MaterialInput {
  id: string;
  name: string;
  unit: string;
  order_unit: number;
  moq: number | null;
  lead_time_bdays: number;
  stock_qty: number;
}

export function parseMaterial(fd: Source): Parsed<MaterialInput> {
  const errors: FieldErrors = {};
  const id = text(fd, "id");
  const name = text(fd, "name");
  const unit = text(fd, "unit") || "개";
  const orderUnit = number(fd, "order_unit");
  const moq = number(fd, "moq");
  const leadTime = number(fd, "lead_time_bdays");
  const stock = number(fd, "stock_qty") ?? 0;

  if (!CODE_RE.test(id)) errors.id = "코드는 공백·/·?·#·% 없이 40자 이내로 입력하세요.";
  if (!name) errors.name = "이름을 입력하세요.";
  if (orderUnit === null || !(orderUnit > 0)) errors.order_unit = "발주 단위는 0보다 큰 숫자여야 합니다.";
  if (moq !== null && !(moq >= 0)) errors.moq = "최소 발주수량은 0 이상의 숫자여야 합니다. 없으면 비워 두세요.";
  if (leadTime === null || !Number.isInteger(leadTime) || leadTime < 0 || leadTime > 365) {
    errors.lead_time_bdays = "리드타임은 0~365 사이의 정수(영업일)여야 합니다.";
  }
  if (!(stock >= 0)) errors.stock_qty = "현재 재고는 0 이상의 숫자여야 합니다.";

  return finish({ id, name, unit, order_unit: orderUnit!, moq, lead_time_bdays: leadTime!, stock_qty: stock }, errors);
}

export const PROJECT_STATUSES = ["planned", "in_progress", "done", "cancelled"] as const;
export type ProjectStatusValue = (typeof PROJECT_STATUSES)[number];

export interface ProjectInput {
  name: string;
  product_id: string;
  production_qty: number;
  start_date: string;
  status: ProjectStatusValue;
}

export function parseProject(fd: Source): Parsed<ProjectInput> {
  const errors: FieldErrors = {};
  const name = text(fd, "name");
  const productId = text(fd, "product_id");
  const qty = number(fd, "production_qty");
  const startDate = text(fd, "start_date");
  const status = (text(fd, "status") || "planned") as ProjectStatusValue;

  if (!name) errors.name = "프로젝트명을 입력하세요.";
  if (!productId) errors.product_id = "제품을 선택하세요.";
  if (qty === null || !(qty > 0)) errors.production_qty = "생산수량은 0보다 큰 숫자여야 합니다.";
  if (!isValidISODate(startDate)) errors.start_date = "생산시작일을 선택하세요.";
  if (!PROJECT_STATUSES.includes(status)) errors.status = "상태를 선택하세요.";

  return finish({ name, product_id: productId, production_qty: qty!, start_date: startDate, status }, errors);
}

export interface ProductInput {
  id: string;
  name: string;
}

export function parseProduct(fd: Source): Parsed<ProductInput> {
  const errors: FieldErrors = {};
  const id = text(fd, "id");
  const name = text(fd, "name");
  if (!CODE_RE.test(id)) errors.id = "코드는 공백·/·?·#·% 없이 40자 이내로 입력하세요.";
  if (!name) errors.name = "제품명을 입력하세요.";
  return finish({ id, name }, errors);
}

export interface BomItemInput {
  material_id: string;
  qty_per_unit: number;
}

export function parseBomItem(fd: Source): Parsed<BomItemInput> {
  const errors: FieldErrors = {};
  const materialId = text(fd, "material_id");
  const qty = number(fd, "qty_per_unit");
  if (!materialId) errors.material_id = "부자재를 선택하세요.";
  if (qty === null || !(qty > 0)) errors.qty_per_unit = "소요량은 0보다 큰 숫자여야 합니다.";
  return finish({ material_id: materialId, qty_per_unit: qty! }, errors);
}

export interface SettingsInput {
  buffer_bdays: number;
  imminent_bdays: number;
  merge_window_bdays: number;
}

export function parseSettings(fd: Source): Parsed<SettingsInput> {
  const errors: FieldErrors = {};
  const intIn = (key: keyof SettingsInput, lo: number, hi: number, label: string) => {
    const n = number(fd, key);
    if (n === null || !Number.isInteger(n) || n < lo || n > hi) {
      errors[key] = `${label}은(는) ${lo}~${hi} 사이의 정수(영업일)여야 합니다.`;
    }
    return n!;
  };
  const data = {
    buffer_bdays: intIn("buffer_bdays", 0, 10, "여유일"),
    imminent_bdays: intIn("imminent_bdays", 0, 30, "임박 기준"),
    merge_window_bdays: intIn("merge_window_bdays", 0, 30, "합치기 기간"),
  };
  return finish(data, errors);
}

export interface HolidayInput {
  date: string;
  name: string;
}

export function parseHoliday(fd: Source): Parsed<HolidayInput> {
  const errors: FieldErrors = {};
  const date = text(fd, "date");
  const name = text(fd, "name");
  if (!isValidISODate(date)) errors.date = "날짜를 선택하세요.";
  if (!name) errors.name = "휴무 이름을 입력하세요.";
  return finish({ date, name }, errors);
}

export const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SignInInput {
  email: string;
  password: string;
}

export function parseSignIn(fd: Source): Parsed<SignInInput> {
  const errors: FieldErrors = {};
  const email = text(fd, "email").toLowerCase();
  const password = String(fd.get("password") ?? "");
  if (!EMAIL_RE.test(email)) errors.email = "이메일을 확인해 주세요.";
  if (!password) errors.password = "비밀번호를 입력하세요.";
  return finish({ email, password }, errors);
}

export interface SignUpInput extends SignInInput {
  name: string;
}

export function parseSignUp(fd: Source): Parsed<SignUpInput> {
  const errors: FieldErrors = {};
  const name = text(fd, "name");
  const email = text(fd, "email").toLowerCase();
  const password = String(fd.get("password") ?? "");
  const confirm = String(fd.get("password_confirm") ?? "");
  if (!name) errors.name = "이름을 입력하세요.";
  if (!EMAIL_RE.test(email)) errors.email = "이메일을 확인해 주세요.";
  if (password.length < MIN_PASSWORD_LENGTH) errors.password = `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`;
  else if (password !== confirm) errors.password_confirm = "비밀번호가 서로 다릅니다.";
  return finish({ name, email, password }, errors);
}

/** Postgres 오류 코드를 사람이 읽을 문장으로 */
export function dbErrorMessage(error: { code?: string; message: string }, what: string): string {
  switch (error.code) {
    case "23505":
      return `같은 코드의 ${what}이(가) 이미 있습니다.`;
    case "23503":
      return `다른 데이터가 이 ${what}을(를) 쓰고 있어 삭제할 수 없습니다. 연결된 데이터를 먼저 정리하세요.`;
    case "42501":
      return "권한이 없습니다.";
    default:
      return `저장하지 못했습니다: ${error.message}`;
  }
}

export const CONFLICT_MESSAGE = "다른 팀원이 먼저 수정했습니다. 새로고침해서 최신 값을 확인한 뒤 다시 입력해 주세요.";
