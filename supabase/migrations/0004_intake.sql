-- 받은 내용(말·글)을 정리해서 확인한 뒤 재고·생산일정에 반영한다.
-- Supabase 대시보드 → SQL Editor 에 이 파일 내용을 붙여 넣고 실행한다.

-- 부자재·프로젝트를 다르게 부르는 이름, 포장 단위 ---------------------------
-- aliases: {"스크류","볼트"}            사람마다 다르게 부르는 이름
-- packs:   [{"unit":"박스","qty":800}]   포장 단위 하나에 낱개가 몇 개인지
alter table materials add column aliases text[] not null default '{}';
alter table materials add column packs jsonb not null default '[]';
alter table projects add column aliases text[] not null default '{}';

-- 받은 내용 ----------------------------------------------------------------
create type intake_status as enum ('pending', 'confirmed', 'discarded');

create table intake_items (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('text', 'audio')),
  original_text text not null,
  -- 정리한 방식: rules(규칙), hybrid@llama3.1:8b(이 PC의 LLM) 등
  method text not null,
  -- 정리 결과. [{"kind":"stock_report","materialId":"A","qty":2000},
  --             {"kind":"schedule_change","projectId":"…","startDate":"2026-11-24","productionQty":150}]
  records jsonb not null default '[]',
  needs_review boolean not null default false,
  reasons jsonb not null default '[]',
  status intake_status not null default 'pending',
  created_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  decided_at timestamptz,
  decided_by uuid references profiles (id),
  -- 확정할 때 실제로 반영한 내용과 바꾸기 전 값 (나중에 추적할 수 있게)
  applied jsonb
);

create index intake_items_status_idx on intake_items (status, created_at desc);

alter table intake_items enable row level security;
create policy "팀원 전체" on intake_items for all to authenticated using (is_member()) with check (is_member());
alter publication supabase_realtime add table intake_items;

-- 확정: 사람이 확인한 레코드를 재고·생산일정에 반영한다. 하나라도 잘못되면 아무것도 바뀌지 않는다.
create function confirm_intake(p_id uuid, p_records jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare
  r jsonb;
  v_applied jsonb := '[]'::jsonb;
  v_before jsonb;
  v_qty numeric;
  v_date date;
begin
  if not is_member() then
    raise exception '승인된 팀원만 할 수 있습니다';
  end if;
  perform 1 from intake_items where id = p_id and status = 'pending' for update;
  if not found then
    raise exception '이미 처리했거나 없는 항목입니다';
  end if;
  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) = 0 then
    raise exception '반영할 내용이 없습니다';
  end if;

  for r in select * from jsonb_array_elements(p_records) loop
    if r ->> 'kind' = 'stock_report' then
      v_qty := (r ->> 'qty')::numeric;
      if v_qty is null or v_qty < 0 then
        raise exception '재고 수량이 올바르지 않습니다';
      end if;
      select jsonb_build_object('stockQty', stock_qty) into v_before from materials where id = r ->> 'materialId' for update;
      if v_before is null then
        raise exception '없는 부자재입니다 (%)', r ->> 'materialId';
      end if;
      update materials set stock_qty = v_qty, updated_at = now(), updated_by = auth.uid() where id = r ->> 'materialId';
    elsif r ->> 'kind' = 'schedule_change' then
      v_qty := (r ->> 'productionQty')::numeric;
      v_date := (r ->> 'startDate')::date;
      if v_qty is null and v_date is null then
        raise exception '바꿀 생산시작일이나 생산수량이 없습니다';
      end if;
      if v_qty is not null and v_qty <= 0 then
        raise exception '생산수량이 올바르지 않습니다';
      end if;
      select jsonb_build_object('startDate', start_date, 'productionQty', production_qty) into v_before
        from projects where id = (r ->> 'projectId')::uuid for update;
      if v_before is null then
        raise exception '없는 프로젝트입니다';
      end if;
      update projects
         set start_date = coalesce(v_date, start_date),
             production_qty = coalesce(v_qty, production_qty),
             updated_at = now(), updated_by = auth.uid()
       where id = (r ->> 'projectId')::uuid;
    else
      raise exception '알 수 없는 종류입니다 (%)', r ->> 'kind';
    end if;
    v_applied := v_applied || jsonb_build_array(r || jsonb_build_object('before', v_before));
  end loop;

  update intake_items
     set status = 'confirmed', records = p_records, applied = v_applied, decided_at = now(), decided_by = auth.uid()
   where id = p_id;
end;
$$;
