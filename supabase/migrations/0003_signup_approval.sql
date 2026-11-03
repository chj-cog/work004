-- 회원가입 + 관리자 승인
-- 누구나 가입할 수 있지만, 관리자가 승인한 팀원만 업무 데이터에 접근한다.
-- 첫 번째로 가입한 사람(프로필이 하나도 없을 때)은 자동으로 승인된 관리자가 된다.

alter table profiles add column approved boolean not null default false;
-- 이 마이그레이션 전에 초대로 만들어진 사용자는 승인된 것으로 본다
update profiles set approved = true;

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_first boolean := not exists (select 1 from profiles);
begin
  insert into profiles (id, email, name, role, approved)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    case when v_first then 'admin'::user_role else 'member'::user_role end,
    v_first
  );
  return new;
end;
$$;

create function is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and approved);
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and approved);
$$;

-- 기존 정책을 "로그인한 사람" → "승인된 팀원"으로 바꾼다
drop policy "팀원 조회" on profiles;
drop policy "관리자 수정" on profiles;
create policy "팀원·본인 조회" on profiles for select to authenticated using (is_member() or id = auth.uid());
create policy "관리자 수정" on profiles for update to authenticated using (is_admin()) with check (is_admin());

do $$
declare
  t text;
begin
  foreach t in array array['materials', 'products', 'bom_items', 'projects', 'purchase_orders', 'order_allocations'] loop
    execute format('drop policy "팀원 전체" on %I', t);
    execute format('create policy "팀원 전체" on %I for all to authenticated using (is_member()) with check (is_member())', t);
  end loop;
end;
$$;

drop policy "팀원 조회" on holidays;
create policy "팀원 조회" on holidays for select to authenticated using (is_member());
drop policy "팀원 조회" on settings;
create policy "팀원 조회" on settings for select to authenticated using (is_member());
