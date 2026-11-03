-- 부자재 발주 체크리스트 — 초기 스키마 (PRD §5)

-- 팀원 ------------------------------------------------------------------
create type user_role as enum ('admin', 'member');

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text not null default '',
  role user_role not null default 'member',
  created_at timestamptz not null default now()
);

-- 초대된 사용자가 처음 가입하면 프로필을 만든다
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- 기준정보 ----------------------------------------------------------------
create table materials (
  id text primary key,
  name text not null,
  unit text not null default '개',
  order_unit numeric not null check (order_unit > 0),
  moq numeric check (moq >= 0),
  lead_time_bdays integer not null check (lead_time_bdays >= 0),
  stock_qty numeric not null default 0 check (stock_qty >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id)
);

create table products (
  id text primary key,
  name text not null
);

create table bom_items (
  product_id text not null references products (id) on delete cascade,
  material_id text not null references materials (id) on delete restrict,
  qty_per_unit numeric not null check (qty_per_unit > 0),
  primary key (product_id, material_id)
);

-- 생산일정 ----------------------------------------------------------------
create type project_status as enum ('planned', 'in_progress', 'done', 'cancelled');

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  product_id text not null references products (id),
  production_qty numeric not null check (production_qty > 0),
  start_date date not null,
  status project_status not null default 'planned',
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id)
);

-- 발주 --------------------------------------------------------------------
-- 계획 발주는 매번 계산 엔진이 만든다. 이 테이블에는 발주 완료를 체크한 순간부터 저장한다.
create type order_status as enum ('ordered', 'received');

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  material_id text not null references materials (id),
  order_date date not null,
  order_qty numeric not null check (order_qty > 0),
  expected_arrival_date date not null,
  remaining_after_qty numeric not null,
  moq_applied boolean not null default false,
  status order_status not null default 'ordered',
  ordered_at date not null default (now() at time zone 'Asia/Seoul')::date,
  ordered_by uuid references profiles (id),
  received_at date,
  updated_at timestamptz not null default now()
);

create table order_allocations (
  order_id uuid not null references purchase_orders (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  required_qty numeric not null,
  from_stock_qty numeric not null,
  from_order_qty numeric not null,
  primary key (order_id, project_id)
);

-- 입고 처리: 발주 상태 변경과 재고 증가를 한 트랜잭션으로
create function receive_order(p_order_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_material text;
  v_qty numeric;
begin
  update purchase_orders
     set status = 'received',
         received_at = (now() at time zone 'Asia/Seoul')::date,
         updated_at = now()
   where id = p_order_id and status = 'ordered'
  returning material_id, order_qty into v_material, v_qty;

  if v_material is null then
    raise exception '입고 처리할 발주가 없습니다 (이미 입고되었거나 없는 발주)';
  end if;

  update materials
     set stock_qty = stock_qty + v_qty, updated_at = now(), updated_by = auth.uid()
   where id = v_material;
end;
$$;

-- 휴일·설정 ---------------------------------------------------------------
create type holiday_type as enum ('public', 'company');
create type holiday_source as enum ('api', 'manual');

create table holidays (
  date date primary key,
  name text not null,
  type holiday_type not null,
  source holiday_source not null,
  synced_at timestamptz
);

create table settings (
  id boolean primary key default true check (id),
  buffer_bdays integer not null default 3 check (buffer_bdays between 0 and 10),
  imminent_bdays integer not null default 3 check (imminent_bdays >= 0),
  merge_window_bdays integer not null default 5 check (merge_window_bdays >= 0),
  holiday_synced_at timestamptz,
  holiday_sync_error text
);
insert into settings default values;

-- 실시간 반영 (F7) ---------------------------------------------------------
alter publication supabase_realtime add table materials, projects, purchase_orders, holidays;

-- 접근 통제 (RLS) ---------------------------------------------------------
-- 로그인한 팀원은 업무 데이터를 모두 읽고 쓴다. 설정·휴일·팀원 역할은 관리자만 바꾼다.
alter table profiles enable row level security;
alter table materials enable row level security;
alter table products enable row level security;
alter table bom_items enable row level security;
alter table projects enable row level security;
alter table purchase_orders enable row level security;
alter table order_allocations enable row level security;
alter table holidays enable row level security;
alter table settings enable row level security;

create policy "팀원 조회" on profiles for select to authenticated using (true);
create policy "관리자 수정" on profiles for update to authenticated using (is_admin());

create policy "팀원 전체" on materials for all to authenticated using (true) with check (true);
create policy "팀원 전체" on products for all to authenticated using (true) with check (true);
create policy "팀원 전체" on bom_items for all to authenticated using (true) with check (true);
create policy "팀원 전체" on projects for all to authenticated using (true) with check (true);
create policy "팀원 전체" on purchase_orders for all to authenticated using (true) with check (true);
create policy "팀원 전체" on order_allocations for all to authenticated using (true) with check (true);

create policy "팀원 조회" on holidays for select to authenticated using (true);
create policy "관리자 변경" on holidays for all to authenticated using (is_admin()) with check (is_admin());

create policy "팀원 조회" on settings for select to authenticated using (true);
create policy "관리자 수정" on settings for update to authenticated using (is_admin()) with check (is_admin());
