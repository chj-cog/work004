-- 엑셀 가져오기: 여러 테이블을 바꾸는 작업을 한 트랜잭션으로 (중간에 실패하면 모두 되돌린다)

-- 제품·BOM: 파일에 있는 제품은 이름을 갱신하고 BOM을 파일 내용으로 바꾼다
-- p_rows: [{product_id, product_name, material_id, qty_per_unit}]
create function import_bom(p_rows jsonb) returns integer
language plpgsql security invoker set search_path = public as $$
declare
  v_count integer;
begin
  insert into products (id, name)
  select distinct on (r ->> 'product_id') r ->> 'product_id', r ->> 'product_name'
    from jsonb_array_elements(p_rows) r
  on conflict (id) do update set name = excluded.name;

  delete from bom_items
   where product_id in (select distinct r ->> 'product_id' from jsonb_array_elements(p_rows) r);

  insert into bom_items (product_id, material_id, qty_per_unit)
  select r ->> 'product_id', r ->> 'material_id', (r ->> 'qty_per_unit')::numeric
    from jsonb_array_elements(p_rows) r;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 재고: 등록된 부자재의 현재 재고만 바꾼다. 없는 코드가 하나라도 있으면 전부 되돌린다
-- p_rows: [{id, stock_qty}]
create function import_stock(p_rows jsonb) returns integer
language plpgsql security invoker set search_path = public as $$
declare
  v_count integer;
begin
  update materials m
     set stock_qty = (r ->> 'stock_qty')::numeric, updated_at = now(), updated_by = auth.uid()
    from jsonb_array_elements(p_rows) r
   where m.id = r ->> 'id';

  get diagnostics v_count = row_count;
  if v_count <> jsonb_array_length(p_rows) then
    raise exception '등록되지 않은 부자재 코드가 있습니다';
  end if;
  return v_count;
end;
$$;
