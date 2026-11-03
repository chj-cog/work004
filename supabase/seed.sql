-- PRD §4.1 예시 데이터 (개발용)
insert into materials (id, name, unit, order_unit, moq, lead_time_bdays, stock_qty) values
  ('A', '나사', '개', 800, null, 6, 500),
  ('B', '포장박스', '개', 1500, null, 11, 0),
  ('C', '라벨', '개', 1000, null, 8, 0),
  ('D', '완충재', '개', 500, 2000, 6, 0);

insert into products (id, name) values
  ('X', '제품 X'),
  ('Y', '제품 Y');

insert into bom_items (product_id, material_id, qty_per_unit) values
  ('X', 'A', 17), ('X', 'B', 13), ('X', 'C', 15), ('X', 'D', 7),
  ('Y', 'A', 9), ('Y', 'C', 11);

insert into projects (name, product_id, production_qty, start_date) values
  ('P1', 'X', 100, '2026-11-20'),
  ('P2', 'Y', 100, '2026-11-24');
