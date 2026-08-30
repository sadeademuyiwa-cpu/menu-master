-- ============================================================================
-- MENU MASTER NG -- Phase 6 legacy replay
--
-- The one thing the normal suites cannot check: what happens to data that
-- already existed. Every suite runs on a database migrated to head, so none of
-- them can hold a row created under the OLD rules.
--
-- This file is the second half of a two-step check. Run it against a database
-- built to 0042, then apply 0043-0048 over it, then run the assertions at the
-- bottom. scripts/verify_legacy.sh does all three.
--
-- What it defends: until 0045, orders.status defaulted to 'confirmed' while
-- finalised_at was set only by fn_finalise_order, so an order inserted and
-- never explicitly finalised was counted as revenue but never locked. Phase 6
-- keys revenue on finalised_at. Without reconciliation those orders would have
-- silently dropped out of the owner's historical figures.
-- ============================================================================

\if :{?assert}
\else

-- ---------------------------------------------------------------------------
-- STEP 1 -- seed, against a database at 0042
-- ---------------------------------------------------------------------------
create table _legacy_expect (k text primary key, v numeric);

do $$
declare
  a uuid; u uuid := gen_random_uuid(); b uuid; res jsonb;
  g uuid; kg uuid; ml uuid; l uuid; pc uuid;
  rice uuid := gen_random_uuid(); bowl uuid := gen_random_uuid();
  dish uuid := gen_random_uuid(); soup uuid := gen_random_uuid();
  fmt uuid := gen_random_uuid(); varid uuid; o_fin uuid; o_unfin uuid;
begin
  select id into g  from units where account_id is null and code='g';
  select id into kg from units where account_id is null and code='kg';
  select id into ml from units where account_id is null and code='ml';
  select id into l  from units where account_id is null and code='l';
  select id into pc from units where account_id is null and code='piece';

  insert into auth.users(id,email) values (u,'legacy@replay.test');
  res := fn_create_account_and_business('Legacy Co','Legacy Kitchen','caterer',u,
           p_idempotency_key=>gen_random_uuid()::text);
  a := (res->>'account_id')::uuid; b := (res->>'business_id')::uuid;

  insert into ingredients(id,account_id,kind,name,base_unit_id) values
    (rice,a,'ingredient','Legacy Rice',g),(bowl,a,'packaging','Legacy Bowl',pc);
  insert into ingredient_prices(account_id,ingredient_id,qty_base,amount,source) values
    (a,rice,fn_resolve_qty_to_base(rice,50,kg),85000,'purchase'),(a,bowl,1,150,'purchase');

  insert into recipes(id,account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty,status)
  values (dish,a,b,'Legacy Jollof',4500,g,500,'active');
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id,is_cost_bearing)
  values (a,dish,rice,4500,g,true);
  perform fn_compute_recipe_cost_snapshot(dish);

  insert into recipes(id,account_id,business_id,name,batch_yield_qty,yield_unit_id,status)
  values (soup,a,b,'Legacy Soup',5000,ml,'active');
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id,is_cost_bearing)
  values (a,soup,rice,5000,g,true);
  insert into serving_formats(id,account_id,business_id,name,capacity_qty,capacity_unit_id)
  values (fmt,a,b,'Legacy 1L',1,l);
  insert into serving_format_packaging(account_id,business_id,format_id,packaging_item_id,qty,is_cost_bearing)
  values (a,b,fmt,bowl,1,true);
  insert into recipe_variants(account_id,business_id,recipe_id,format_id,costing_basis)
  values (a,b,soup,fmt,'capacity') returning id into varid;
  perform fn_compute_recipe_cost_snapshot(soup);
  perform fn_compute_variant_cost_snapshot(varid);   -- a PRE-0046 variant snapshot

  -- (a) went through fn_finalise_order, so it has a confirmation time
  insert into orders(account_id,business_id,order_no,order_date)
  values (a,b,'LEGACY-FINALISED',current_date-30) returning id into o_fin;
  insert into order_lines(account_id,order_id,recipe_id,qty,unit_price)
  values (a,o_fin,dish,10,1500);
  insert into order_lines(account_id,order_id,recipe_id,variant_id,qty,unit_price)
  values (a,o_fin,soup,varid,2,3000);
  perform fn_finalise_order(o_fin);

  -- (b) left on the old default: reads as confirmed, has no confirmation time
  insert into orders(account_id,business_id,order_no,order_date)
  values (a,b,'LEGACY-NEVER-FINALISED',current_date-20) returning id into o_unfin;
  insert into order_lines(account_id,order_id,recipe_id,qty,unit_price)
  values (a,o_unfin,dish,4,1500);

  -- (c) a quick sale
  insert into sales_entries(account_id,business_id,sale_date,recipe_id,qty,unit_price)
  values (a,b,current_date-10,dish,6,1500);
end $$;

-- What the owner's reports said BEFORE Phase 6. These are the numbers that
-- must not move.
insert into _legacy_expect
select 'revenue', round(sum(revenue),2) from v_sales_unified
union all select 'cogs', round(sum(cogs),2) from v_sales_unified
union all select 'orders', count(*) from orders
union all select 'frozen_lines', count(*) from order_lines where unit_cost_at_sale is not null
union all select 'frozen_total', sum(qty*unit_cost_at_sale) from order_lines;

select k as figure_before_phase_6, v from _legacy_expect order by k;

\endif

\if :{?assert}
-- ---------------------------------------------------------------------------
-- STEP 2 -- assert, after 0043-0048 have been applied over the same rows
-- ---------------------------------------------------------------------------
create temp table t35 (n int, check_name text, verdict text, detail text);

insert into t35
select 1, 'historical revenue is unchanged',
       case when round(sum(revenue),2) = (select v from _legacy_expect where k='revenue')
            then 'PASS' else 'FAIL' end,
       'was '||(select v from _legacy_expect where k='revenue')||', now '||round(sum(revenue),2)
  from v_sales_unified;

insert into t35
select 2, 'historical cost of sales is unchanged',
       case when round(sum(cogs),2) = (select v from _legacy_expect where k='cogs')
            then 'PASS' else 'FAIL' end,
       'was '||(select v from _legacy_expect where k='cogs')||', now '||round(sum(cogs),2)
  from v_sales_unified;

insert into t35
select 3, 'every frozen cost is byte-for-byte what it was',
       case when sum(qty*unit_cost_at_sale) = (select v from _legacy_expect where k='frozen_total')
             and count(*) filter (where unit_cost_at_sale is not null)
                 = (select v from _legacy_expect where k='frozen_lines')
            then 'PASS' else 'FAIL' end,
       'total '||sum(qty*unit_cost_at_sale)||' over '
       ||count(*) filter (where unit_cost_at_sale is not null)||' frozen line(s)'
  from order_lines;

insert into t35
select 4, 'no historical status was rewritten',
       case when count(*) filter (where status::text <> 'confirmed') = 0
            then 'PASS' else 'FAIL' end,
       string_agg(distinct status::text, ', ')
  from orders;

insert into t35
select 5, 'the order the old default left behind now carries a confirmation time',
       case when finalised_at is not null and finalised_at = created_at
            then 'PASS' else 'FAIL' end,
       'finalised_at '||coalesce(finalised_at::text,'NULL')
       ||' taken from created_at: '||(finalised_at = created_at)::text
  from orders where order_no = 'LEGACY-NEVER-FINALISED';

insert into t35
select 6, 'and it is still counted, exactly once',
       case when count(*) = 1 and round(sum(revenue),2) = 6000.00 then 'PASS' else 'FAIL' end,
       count(*)||' line(s), '||coalesce(round(sum(revenue),2)::text,'none')
  from v_sales_unified u join orders o on o.id = u.order_id
 where o.order_no = 'LEGACY-NEVER-FINALISED';

insert into t35
select 7, 'no order reads as a sale without a confirmation time',
       case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*)||' left'
  from orders where status not in ('draft','cancelled')
    and finalised_at is null and voided_at is null;

insert into t35
select 8, 'no historical sale was re-costed at today''s prices',
       case when not exists (
              select 1 from order_lines ol join cost_snapshots cs on cs.id = ol.cost_snapshot_id
               where cs.computed_at > (select min(created_at) from orders))
            then 'PASS' else 'FAIL' end,
       'every frozen snapshot predates the orders that reference it';

insert into t35
select 9, 'a snapshot written before 0046 keeps NULL provenance',
       case when portion_qty_at_snapshot is null and variant_overhead_cost is null
            then 'PASS' else 'FAIL' end,
       'portion '||coalesce(portion_qty_at_snapshot::text,'NULL')
       ||', variant overhead '||coalesce(variant_overhead_cost::text,'NULL')
  from cost_snapshots where variant_id is not null;

-- Only the columns 0046 introduced are missing on a legacy row. What was
-- already stored -- cost_per_yield_unit, resolved_qty and, since 0021, the
-- format's own packaging -- is still there and is still reported. The point is
-- that the view reports the gap rather than filling it from today's settings.
insert into t35
select 10, 'the provenance 0046 introduced reads as not recorded, not as a number',
       case when portion_qty_at_snapshot is null then 'PASS' else 'FAIL' end,
       'portion at snapshot: '||coalesce(portion_qty_at_snapshot::text,'not recorded')
       ||' | still recorded from before 0046: ingredients/labour '
       ||coalesce(ingredients_and_labour::text,'not recorded')
       ||', packaging '||coalesce(packaging_cost::text,'not recorded')
  from v_sale_cost_breakdown where variant_id is not null;

-- Where every component IS present, it must add up. Where one is missing, the
-- view must not pretend otherwise.
insert into t35
select 11, 'wherever a full breakdown exists, it reconciles to the frozen total',
       case when count(*) filter (
              where ingredients_and_labour is not null and packaging_cost is not null
                and overhead_cost is not null
                and round(ingredients_and_labour + packaging_cost + overhead_cost, 2)
                    <> round(unit_cost_at_sale, 2)) = 0
            then 'PASS' else 'FAIL' end,
       count(*) filter (where ingredients_and_labour is not null
                          and packaging_cost is not null and overhead_cost is not null)
       ||' complete breakdown(s), '
       ||count(*) filter (where ingredients_and_labour is null or packaging_cost is null
                            or overhead_cost is null)||' reported incomplete'
  from v_sale_cost_breakdown;

select * from t35 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict<>'PASS') as fail from t35;
\endif
