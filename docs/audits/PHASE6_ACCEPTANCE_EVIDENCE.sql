-- ============================================================================
-- MENU MASTER NG -- Phase 6 acceptance evidence
--
-- Not a test suite. One realistic sale, driven through the shipped system, with
-- every figure printed at each stage so the owner can check the arithmetic by
-- hand and see that what the screen shows is what the database holds.
--
-- The sale is built to exercise every hard case at once:
--   a portion-model line, with a line discount
--   a format-model line (2.5 litre), with its own packaging
--   a line whose product has never been costed
--   an order discount that does NOT divide evenly
--
-- Run on a database with 0001-0048 applied. Rolls everything back.
-- ============================================================================
begin;
\pset format aligned
\pset border 2

create temp table fxa (
  acct uuid, usr uuid, biz uuid, g uuid, kg uuid, ml uuid, l uuid, pc uuid,
  rice uuid, bowl uuid, tub uuid, jollof uuid, soup uuid, mystery uuid,
  cust uuid, f1l uuid, f25l uuid, v1l uuid, v25l uuid, ord uuid,
  l1 uuid, l2 uuid, l3 uuid
) on commit drop;

do $$
declare
  a uuid; u uuid := gen_random_uuid(); b uuid; res jsonb;
  g uuid; kg uuid; ml uuid; l uuid; pc uuid;
  rice uuid := gen_random_uuid(); bowl uuid := gen_random_uuid(); tub uuid := gen_random_uuid();
  jollof uuid := gen_random_uuid(); soup uuid := gen_random_uuid(); mystery uuid := gen_random_uuid();
  cust uuid := gen_random_uuid(); f1l uuid := gen_random_uuid(); f25l uuid := gen_random_uuid();
  v1l uuid; v25l uuid; spice uuid := gen_random_uuid();
begin
  select id into g  from units where account_id is null and code='g';
  select id into kg from units where account_id is null and code='kg';
  select id into ml from units where account_id is null and code='ml';
  select id into l  from units where account_id is null and code='l';
  select id into pc from units where account_id is null and code='piece';

  insert into auth.users(id,email) values (u,'acceptance@t.test');
  res := fn_create_account_and_business('Adaeze Catering','Adaeze Kitchen','caterer',u,
           p_idempotency_key=>gen_random_uuid()::text);
  a := (res->>'account_id')::uuid; b := (res->>'business_id')::uuid;

  -- N85,000 for 50 kg of rice is N1.70 a gram. N150 a bowl, N400 a tub.
  insert into ingredients(id,account_id,kind,name,base_unit_id) values
    (rice,a,'ingredient','Rice',g),(bowl,a,'packaging','1 litre bowl',pc),
    (tub,a,'packaging','2.5 litre tub',pc),(spice,a,'ingredient','Unpriced spice',g);
  insert into ingredient_prices(account_id,ingredient_id,qty_base,amount,source) values
    (a,rice,fn_resolve_qty_to_base(rice,50,kg),85000,'purchase'),
    (a,bowl,1,150,'purchase'),(a,tub,1,400,'purchase');

  -- MODEL 1: 4,500 g batch, 500 g portion -> N850 a plate
  insert into recipes(id,account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty,status)
  values (jollof,a,b,'Party Jollof',4500,g,500,'active');
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id,is_cost_bearing)
  values (a,jollof,rice,4500,g,true);
  perform fn_compute_recipe_cost_snapshot(jollof);

  -- MODEL 2: 5,000 ml batch at N1.70/ml, two formats with different packaging
  insert into recipes(id,account_id,business_id,name,batch_yield_qty,yield_unit_id,status)
  values (soup,a,b,'Egusi Soup',5000,ml,'active');
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id,is_cost_bearing)
  values (a,soup,rice,5000,g,true);
  insert into serving_formats(id,account_id,business_id,name,capacity_qty,capacity_unit_id)
  values (f1l,a,b,'1 litre',1,l),(f25l,a,b,'2.5 litre',2.5,l);
  insert into serving_format_packaging(account_id,business_id,format_id,packaging_item_id,qty,is_cost_bearing)
  values (a,b,f1l,bowl,1,true),(a,b,f25l,tub,1,true);
  insert into recipe_variants(account_id,business_id,recipe_id,format_id,costing_basis)
  values (a,b,soup,f1l,'capacity') returning id into v1l;
  insert into recipe_variants(account_id,business_id,recipe_id,format_id,costing_basis)
  values (a,b,soup,f25l,'capacity') returning id into v25l;
  perform fn_compute_recipe_cost_snapshot(soup);
  perform fn_compute_variant_cost_snapshot(v1l);
  perform fn_compute_variant_cost_snapshot(v25l);

  -- A dish nobody has priced the inputs for.
  insert into recipes(id,account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty,status)
  values (mystery,a,b,'Mystery Stew',4000,g,400,'active');
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id,is_cost_bearing)
  values (a,mystery,spice,4000,g,true);
  perform fn_compute_recipe_cost_snapshot(mystery);

  insert into customers(id,account_id,business_id,name,company)
  values (cust,a,b,'Mrs Adeyemi','Adeyemi Events');

  insert into fxa (acct,usr,biz,g,kg,ml,l,pc,rice,bowl,tub,jollof,soup,mystery,
                   cust,f1l,f25l,v1l,v25l)
  values (a,u,b,g,kg,ml,l,pc,rice,bowl,tub,jollof,soup,mystery,cust,f1l,f25l,v1l,v25l);
end $$;

\echo ''
\echo '=== 1. WHAT EACH PRODUCT COSTS BEFORE ANY SALE ============================'
select r.name as product,
       coalesce(f.name,'sold by the plate') as sold_as,
       to_char(cs.cost_per_yield_unit,'FM999990.0000') as per_unit_of_batch,
       coalesce(to_char(cs.cost_per_portion,'FM999,999,990.00'),'not known') as cost_of_one,
       cs.is_complete as costing_complete
  from cost_snapshots cs
  join recipes r on r.id = cs.recipe_id
  left join recipe_variants rv on rv.id = cs.variant_id
  left join serving_formats f on f.id = rv.format_id
 where cs.id in (select distinct on (recipe_id, variant_id) id from cost_snapshots
                  order by recipe_id, variant_id, computed_at desc, seq desc)
 order by r.name, f.name nulls first;

-- ---------------------------------------------------------------------------
-- THE SALE
-- ---------------------------------------------------------------------------
do $$
declare f record; v_ord uuid; v_l1 uuid; v_l2 uuid; v_l3 uuid;
begin
  select * into f from fxa;
  insert into orders(account_id,business_id,customer_id,order_no,order_date)
  values (f.acct,f.biz,f.cust,'ORD-0001',current_date) returning id into v_ord;

  -- 20 plates at N1,500, with N2,000 taken off the line
  insert into order_lines(account_id,order_id,recipe_id,qty,unit_price,discount_amount)
  values (f.acct,v_ord,f.jollof,20,1500,2000) returning id into v_l1;
  -- 3 of the 2.5 litre soup at N8,000
  insert into order_lines(account_id,order_id,recipe_id,variant_id,qty,unit_price)
  values (f.acct,v_ord,f.soup,f.v25l,3,8000) returning id into v_l2;
  -- 5 of the dish nobody has costed, at N2,000
  insert into order_lines(account_id,order_id,recipe_id,qty,unit_price)
  values (f.acct,v_ord,f.mystery,5,2000) returning id into v_l3;

  update orders set order_discount = 5000 where id = v_ord;
  update fxa set ord = v_ord, l1 = v_l1, l2 = v_l2, l3 = v_l3;
end $$;

\echo ''
\echo '=== 2. WHILE IT IS STILL A DRAFT =========================================='
select case when o.finalised_at is null then 'draft' else 'confirmed' end as state,
       (select count(*) from v_sales_unified where order_id = o.id) as rows_in_revenue_reporting,
       (select count(*) from v_sale_lines where order_id = o.id
         and unit_cost_at_sale is not null) as lines_with_a_frozen_cost,
       a.attention, a.what_to_do
  from orders o join fxa x on x.ord = o.id
  join v_orders_attention a on a.order_id = o.id;

do $$ declare f record; r jsonb; begin
  select * into f from fxa;
  r := fn_confirm_order(f.ord);
  raise notice 'fn_confirm_order returned: %', r::text;
end $$;

\echo ''
\echo '=== 3. THE SALE, LINE BY LINE, AS THE OWNER SEES IT ======================='
select left(coalesce(sl.product_name,'-'),13) as product,
       coalesce(sl.format_name,'plate') as size,
       sl.qty,
       to_char(sl.unit_price,'FM999,990.00')       as price_each,
       to_char(sl.gross_revenue,'FM999,990.00')    as gross,
       to_char(sl.line_discount,'FM999,990.00')    as line_disc,
       to_char(sl.allocated_order_discount,'FM999,990.00') as order_disc_share,
       to_char(sl.net_revenue,'FM999,990.00')      as net,
       coalesce(to_char(sl.unit_cost_at_sale,'FM999,990.00'),'not known') as cost_each,
       coalesce(to_char(sl.cogs,'FM999,990.00'),'not known')         as cost_total,
       coalesce(to_char(sl.gross_profit,'FM999,990.00'),'not known') as kept,
       sl.cost_status
  from v_sale_lines sl join fxa x on x.ord = sl.order_id
 order by sl.gross_revenue desc;

\echo ''
\echo '=== 4. THE ALLOCATION OF THE N5,000 ORDER DISCOUNT ========================'
select left(coalesce(r.name,'-'),13) as product,
       to_char(a.gross_revenue,'FM999,990.00')  as gross,
       to_char(a.line_discount,'FM999,990.00')  as line_disc,
       to_char(a.line_revenue,'FM999,990.00')   as line_revenue,
       to_char(round(100.0*a.line_revenue/sum(a.line_revenue) over (),4),'FM990.0000')||' %' as share_of_order,
       to_char(round(5000*a.line_revenue/sum(a.line_revenue) over (),2),'FM999,990.00') as raw_pro_rata,
       to_char(a.allocated_order_discount,'FM999,990.00') as allocated,
       to_char(a.allocated_order_discount
               - round(5000*a.line_revenue/sum(a.line_revenue) over (),2),'FM990.00') as residual,
       to_char(a.net_revenue,'FM999,990.00') as net
  from fn_allocate_order_discount((select ord from fxa)) a
  left join order_lines ol on ol.id = a.order_line_id
  left join recipes r on r.id = ol.recipe_id
 order by a.line_revenue desc;

select to_char(sum(allocated_order_discount),'FM999,990.00') as sum_allocated,
       to_char((select order_discount from orders where id=(select ord from fxa)),'FM999,990.00') as order_discount,
       case when sum(allocated_order_discount)
               = (select order_discount from orders where id=(select ord from fxa))
            then 'EXACT' else 'MISMATCH' end as reconciles,
       to_char(sum(net_revenue),'FM999,990.00') as sum_net_line_revenue,
       to_char(sum(line_revenue) - (select order_discount from orders where id=(select ord from fxa)),'FM999,990.00')
         as line_revenue_less_order_discount
  from fn_allocate_order_discount((select ord from fxa));

\echo ''
\echo '=== 5. THE WHOLE SALE, AND THE FLATTERING FIGURE IT REFUSES TO REPORT ====='
select to_char(s.gross_revenue,'FM999,990.00')     as gross_revenue,
       to_char(s.discount_given,'FM999,990.00')    as discounts_given,
       to_char(s.revenue,'FM999,990.00')           as revenue,
       to_char(s.costed_revenue,'FM999,990.00')    as costed_revenue,
       to_char(s.revenue_without_cost,'FM999,990.00') as uncosted_revenue,
       to_char(s.cogs,'FM999,990.00')              as known_cost,
       to_char(s.gross_profit,'FM999,990.00')      as gross_profit,
       to_char(s.gross_margin_pct,'FM990.00')||' %'   as gross_margin,
       to_char(s.cost_coverage_pct,'FM990.00')||' %'  as cost_coverage
  from v_sales_summary s join fxa x on x.biz = s.business_id;

select to_char(revenue - cogs,'FM999,990.00')  as if_it_used_total_revenue,
       to_char(gross_profit,'FM999,990.00')    as what_it_actually_reports,
       to_char(revenue - cogs - gross_profit,'FM999,990.00') as difference,
       to_char(revenue_without_cost,'FM999,990.00') as uncosted_revenue,
       case when revenue - cogs - gross_profit = revenue_without_cost
            then 'the difference IS the uncosted revenue, to the kobo'
            else 'MISMATCH' end as proof
  from v_sales_summary s join fxa x on x.biz = s.business_id;

\echo ''
\echo '=== 6. THE FROZEN BREAKDOWN OF THE 2.5 LITRE LINE ========================='
select coalesce(to_char(b.ingredients_and_labour,'FM999,990.0000'),'not recorded') as ingredients_and_labour,
       coalesce(to_char(b.packaging_cost,'FM999,990.0000'),'not recorded')         as format_packaging,
       coalesce(to_char(b.overhead_cost,'FM999,990.0000'),'not recorded')          as overhead_share,
       coalesce(to_char(b.resolved_qty,'FM999,990.00'),'not recorded')             as format_quantity,
       coalesce(to_char(b.portion_qty_at_snapshot,'FM999,990.00'),'not recorded')  as portion_at_snapshot,
       to_char(b.unit_cost_at_sale,'FM999,990.0000')                               as frozen_total,
       case when round(b.ingredients_and_labour + b.packaging_cost + b.overhead_cost,4)
                 = round(b.unit_cost_at_sale,4)
            then 'components reconcile to the frozen total' else 'MISMATCH' end as reconciles,
       b.cost_frozen_at
  from v_sale_cost_breakdown b join fxa x on x.l2 = b.line_id;

-- ---------------------------------------------------------------------------
-- HISTORY DOES NOT MOVE
-- ---------------------------------------------------------------------------
create temp table before_after (stage text, revenue numeric, cogs numeric,
  profit numeric, margin numeric, coverage numeric, frozen_cost_l1 numeric,
  frozen_cost_l2 numeric, snapshot_l2 uuid, packaging_l2 numeric) on commit drop;

insert into before_after
select 'before any change', s.revenue, s.cogs, s.gross_profit, s.gross_margin_pct,
       s.cost_coverage_pct,
       (select unit_cost_at_sale from order_lines where id=(select l1 from fxa)),
       (select unit_cost_at_sale from order_lines where id=(select l2 from fxa)),
       (select cost_snapshot_id  from order_lines where id=(select l2 from fxa)),
       (select packaging_cost from v_sale_cost_breakdown where line_id=(select l2 from fxa))
  from v_sales_summary s join fxa x on x.biz = s.business_id;

do $$
declare f record; lr uuid; pur uuid;
begin
  select * into f from fxa;

  -- 1 ingredient price
  insert into ingredient_prices(account_id,ingredient_id,qty_base,amount,source)
  values (f.acct,f.rice,fn_resolve_qty_to_base(f.rice,50,f.kg),500000,'manual');
  -- 2 a posted purchase
  insert into purchases(account_id,business_id,purchase_date,reference)
  values (f.acct,f.biz,current_date,'LATER') returning id into pur;
  insert into purchase_lines(account_id,purchase_id,ingredient_id,qty,unit_id,amount)
  values (f.acct,pur,f.rice,50,f.kg,900000);
  perform fn_post_purchase(pur);
  -- 3 recipe composition
  update recipe_lines set qty = 9000 where recipe_id = f.jollof;
  -- 4 yield, and 5 portion size
  update recipes set batch_yield_qty = 9000, portion_qty = 250 where id = f.jollof;
  update recipes set batch_yield_qty = 2000 where id = f.soup;
  -- 6 packaging price
  insert into ingredient_prices(account_id,ingredient_id,qty_base,amount,source)
  values (f.acct,f.tub,1,9999,'manual');
  -- 7 format configuration
  update serving_formats set capacity_qty = 9 where id = f.f25l;
  -- 8 labour
  insert into labour_rates(id,account_id,business_id,name,rate_per_hour,is_active)
  values (gen_random_uuid(),f.acct,f.biz,'Cook',5000,true) returning id into lr;
  insert into recipe_labour(account_id,recipe_id,labour_rate_id,hours)
  values (f.acct,f.jollof,lr,4);
  -- 9 overhead
  update business_settings set overhead_enabled = true,
         overhead_basis_qty = 100000, overhead_basis_unit_id = f.g
   where business_id = f.biz;
  insert into overhead_items(id,account_id,business_id,name,monthly_cost,is_active,
                             basis_qty,basis_unit_id)
  values (gen_random_uuid(),f.acct,f.biz,'Rent',600000,true,100000,f.g);
  -- 10 the current selling price
  insert into recipe_prices(account_id,recipe_id,price,effective_from)
  values (f.acct,f.jollof,9999,current_date);

  perform fn_compute_recipe_cost_snapshot(f.jollof);
  perform fn_compute_recipe_cost_snapshot(f.soup);
  perform fn_compute_variant_cost_snapshot(f.v25l);
end $$;

insert into before_after
select 'after ten changes', s.revenue, s.cogs, s.gross_profit, s.gross_margin_pct,
       s.cost_coverage_pct,
       (select unit_cost_at_sale from order_lines where id=(select l1 from fxa)),
       (select unit_cost_at_sale from order_lines where id=(select l2 from fxa)),
       (select cost_snapshot_id  from order_lines where id=(select l2 from fxa)),
       (select packaging_cost from v_sale_cost_breakdown where line_id=(select l2 from fxa))
  from v_sales_summary s join fxa x on x.biz = s.business_id;

\echo ''
\echo '=== 7. THE CONFIRMED SALE, BEFORE AND AFTER TEN CHANGES =================='
select stage,
       to_char(revenue,'FM999,990.00') as revenue,
       to_char(cogs,'FM999,990.00') as cogs,
       to_char(profit,'FM999,990.00') as profit,
       to_char(margin,'FM990.00')||' %' as margin,
       to_char(coverage,'FM990.00')||' %' as coverage,
       to_char(frozen_cost_l1,'FM999,990.00') as jollof_frozen,
       to_char(frozen_cost_l2,'FM999,990.00') as soup_frozen,
       to_char(packaging_l2,'FM999,990.00') as soup_packaging
  from before_after;

select case when count(distinct (revenue,cogs,profit,margin,coverage,
                                frozen_cost_l1,frozen_cost_l2,snapshot_l2,packaging_l2)) = 1
            then 'IDENTICAL -- revenue, cost, profit, margin, coverage and frozen provenance all unmoved'
            else 'SOMETHING MOVED' end as verdict
  from before_after;

\echo ''
\echo '    ... while the products themselves were repriced:'
select r.name as product, coalesce(f.name,'plate') as size,
       coalesce(to_char(cs.cost_per_portion,'FM999,990.00'),'not known') as cost_today
  from cost_snapshots cs
  join recipes r on r.id = cs.recipe_id
  left join recipe_variants rv on rv.id = cs.variant_id
  left join serving_formats f on f.id = rv.format_id
 where cs.id in (select distinct on (recipe_id, variant_id) id from cost_snapshots
                  order by recipe_id, variant_id, computed_at desc, seq desc)
   and r.name in ('Party Jollof','Egusi Soup')
 order by r.name, f.name nulls first;

-- ---------------------------------------------------------------------------
-- VOID AND REISSUE
-- ---------------------------------------------------------------------------
create temp table vr (stage text, orders_in_reporting int, revenue numeric,
  cogs numeric, profit numeric, note text) on commit drop;

insert into vr select 'confirmed sale only',
  (select count(distinct order_id) from v_sales_unified where business_id=(select biz from fxa)),
  s.revenue, s.cogs, s.gross_profit, 'the original'
  from v_sales_summary s join fxa x on x.biz = s.business_id;

do $$ declare f record; r jsonb; nid uuid; begin
  select * into f from fxa;
  r := fn_void_order(f.ord, 'customer moved the event');
  raise notice 'fn_void_order returned: %', r::text;
end $$;

insert into vr select 'after voiding',
  (select count(distinct order_id) from v_sales_unified where business_id=(select biz from fxa)),
  coalesce(s.revenue,0), coalesce(s.cogs,0), coalesce(s.gross_profit,0), 'original excluded'
  from fxa x left join v_sales_summary s on s.business_id = x.biz;

create temp table reissued (id uuid) on commit drop;
do $$ declare f record; r jsonb; nid uuid; begin
  select * into f from fxa;
  r := fn_reissue_order(f.ord);
  nid := (r->>'new_order_id')::uuid;
  raise notice 'fn_reissue_order returned: %', r::text;
  insert into order_lines(account_id,order_id,recipe_id,qty,unit_price)
  values (f.acct,nid,f.jollof,10,1500);
  perform fn_confirm_order(nid);
  insert into reissued values (nid);
end $$;

insert into vr select 'after the replacement is confirmed',
  (select count(distinct order_id) from v_sales_unified where business_id=(select biz from fxa)),
  s.revenue, s.cogs, s.gross_profit, 'only the replacement counts'
  from v_sales_summary s join fxa x on x.biz = s.business_id;

\echo ''
\echo '=== 8. VOID AND REISSUE =================================================='
select stage, orders_in_reporting as orders_counted,
       to_char(revenue,'FM999,990.00') as revenue,
       to_char(cogs,'FM999,990.00') as cogs,
       to_char(profit,'FM999,990.00') as profit, note
  from vr;

select 'original' as record,
       o.order_no, o.status::text, (o.finalised_at is not null) as confirmed,
       (o.voided_at is not null) as voided, o.void_reason,
       coalesce(o.replaces::text,'-') as replaces,
       to_char((select sum(qty*unit_cost_at_sale) from order_lines where order_id=o.id),'FM999,990.00')
         as frozen_cost_still_readable
  from orders o where o.id = (select ord from fxa)
union all
select 'replacement', o.order_no, o.status::text, (o.finalised_at is not null),
       (o.voided_at is not null), coalesce(o.void_reason,'-'),
       case when o.replaces = (select ord from fxa) then 'points at the original' else '-' end,
       to_char((select sum(qty*unit_cost_at_sale) from order_lines where order_id=o.id),'FM999,990.00')
  from orders o where o.id = (select id from reissued);

\echo ''
\echo '    double-count check: how many times does each order appear in reporting?'
select coalesce(o.order_no,'-') as order_no,
       case when o.voided_at is not null then 'voided'
            when o.finalised_at is null then 'draft' else 'confirmed' end as state,
       count(u.record_id) as lines_in_active_reporting
  from orders o
  left join v_sales_unified u on u.order_id = o.id
 where o.business_id = (select biz from fxa)
 group by o.order_no, o.voided_at, o.finalised_at
 order by 1;

\echo ''
\echo '=== 9. THE REPORTING BOUNDARY ============================================='
\echo '    every order in this business, and how it is treated'
select coalesce(o.order_no,'-') as order_no,
       case when o.voided_at is not null then 'voided'
            when o.finalised_at is null then 'draft'
            else 'confirmed' end as state,
       (select count(*) from order_lines where order_id=o.id) as lines_on_the_order,
       (select count(*) from v_sales_unified u where u.order_id = o.id) as lines_in_reporting,
       (select count(*) from v_sale_lines s where s.order_id = o.id) as lines_the_owner_can_see
  from orders o where o.business_id = (select biz from fxa)
 order by 1;

\echo ''
\echo '    and how a line with no known cost is treated'
select sl.cost_status,
       count(*) as lines,
       to_char(sum(sl.net_revenue),'FM999,990.00') as revenue,
       coalesce(to_char(sum(sl.cogs),'FM999,990.00'),'none known') as cost,
       coalesce(to_char(sum(sl.gross_profit),'FM999,990.00'),'no profit claimed') as profit_contribution
  from v_sale_lines sl
 where sl.order_id in (select id from orders where business_id=(select biz from fxa))
   and sl.is_confirmed
 group by sl.cost_status order by 1;

rollback;
