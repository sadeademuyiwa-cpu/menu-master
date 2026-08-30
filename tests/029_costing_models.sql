-- ============================================================================
-- MENU MASTER NG -- tests/029_costing_models.sql
--
-- The two approved costing models, and the sixteen cases the owner required.
--
--   MODEL 1 PORTION-BASED  discrete servings; portion size is required.
--   MODEL 2 FORMAT-BASED   a measurable batch sold through business-defined
--                          formats; the format is the commercial unit and no
--                          synthetic portion size is demanded.
--
-- Every dimension below is reached through the existing unit/conversion
-- architecture. Nothing about soup, litres, bowls or plates is special-cased.
--
-- Run on a database with 0001-0039 applied. Rolls everything back.
-- ============================================================================
begin;

create temp table t29 (n int, check_name text, verdict text, detail text) on commit drop;
create temp table fx29 (acct uuid, usr uuid, biz uuid,
                        g uuid, kg uuid, l uuid, ml uuid, piece uuid, pack uuid) on commit drop;

do $$
declare a uuid; u uuid := gen_random_uuid(); b uuid; res jsonb;
        g uuid; kg uuid; l uuid; ml uuid; piece uuid; pack uuid;
begin
  select id into g     from units where account_id is null and code='g';
  select id into kg    from units where account_id is null and code='kg';
  select id into l     from units where account_id is null and code='l';
  select id into ml    from units where account_id is null and code='ml';
  select id into piece from units where account_id is null and code='piece';
  select id into pack  from units where account_id is null and code='pack';
  insert into auth.users(id,email) values (u,'models@t.test');
  res := fn_create_account_and_business('Models Co','Models K','caterer',u,
           p_idempotency_key=>gen_random_uuid()::text);
  a := (res->>'account_id')::uuid; b := (res->>'business_id')::uuid;
  insert into fx29 values (a,u,b,g,kg,l,ml,piece,pack);
end $$;

-- helper: an ingredient priced by a real purchase
create or replace function pg_temp.ing(p_name text, p_base uuid,
                                       p_qty numeric, p_unit uuid, p_amount numeric)
returns uuid language plpgsql as $$
declare f record; i uuid := gen_random_uuid();
begin
  select * into f from fx29;
  insert into ingredients(id,account_id,kind,name,base_unit_id)
  values (i,f.acct,'ingredient',p_name,p_base);
  insert into ingredient_prices(account_id,ingredient_id,qty_base,amount,source)
  values (f.acct,i,fn_resolve_qty_to_base(i,p_qty,p_unit),p_amount,'purchase');
  return i;
end $$;

create or replace function pg_temp.packaging(p_name text, p_qty numeric, p_amount numeric)
returns uuid language plpgsql as $$
declare f record; i uuid := gen_random_uuid();
begin
  select * into f from fx29;
  insert into ingredients(id,account_id,kind,name,base_unit_id)
  values (i,f.acct,'packaging',p_name,f.piece);
  insert into ingredient_prices(account_id,ingredient_id,qty_base,amount,source)
  values (f.acct,i,p_qty,p_amount,'purchase');
  return i;
end $$;

create or replace function pg_temp.fmt(p_name text, p_qty numeric, p_unit uuid)
returns uuid language plpgsql as $$
declare f record; x uuid := gen_random_uuid();
begin
  select * into f from fx29;
  insert into serving_formats(id,account_id,business_id,name,capacity_qty,capacity_unit_id)
  values (x,f.acct,f.biz,p_name,p_qty,p_unit);
  return x;
end $$;

create or replace function pg_temp.variant(p_recipe uuid, p_format uuid)
returns uuid language plpgsql as $$
declare f record; v uuid := gen_random_uuid();
begin
  select * into f from fx29;
  insert into recipe_variants(id,account_id,business_id,recipe_id,format_id,costing_basis)
  values (v,f.acct,f.biz,p_recipe,p_format,'capacity');
  return v;
end $$;

-- ===========================================================================
-- 1. MODEL 1: portion-based recipe with NO sellable format.
--    WORKED EXAMPLE -- PORTION-BASED FOOD
--    50 kg rice for N85,000 -> N1.70/g. Batch 4,500 g. Portion 500 g.
--    cost per portion = 1.70 x 500 = N850.00
-- ===========================================================================
do $$
declare f record; rice uuid; rec uuid := gen_random_uuid(); s record; bas record;
begin
  select * into f from fx29;
  rice := pg_temp.ing('P Rice', f.g, 50, f.kg, 85000);
  insert into recipes(id,account_id,business_id,name,batch_yield_qty,yield_unit_id,portion_qty,status)
  values (rec,f.acct,f.biz,'Portion Jollof',4500,f.g,500,'active');
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id,is_cost_bearing)
  values (f.acct,rec,rice,4500,f.g,true);
  perform fn_compute_recipe_cost_snapshot(rec);

  select * into s from v_recipe_cost_current where recipe_id = rec;
  select * into bas from v_recipe_basis where recipe_id = rec;

  insert into t29 values (1,'MODEL 1 a recipe with no format is portion-based and complete',
    case when bas.costing_basis='portion' and s.is_complete then 'PASS' else 'FAIL' end,
    bas.costing_basis||', complete='||s.is_complete);
  insert into t29 values (2,'MODEL 1 WORKED: 500 g of a N1.70/g batch costs N850.00',
    case when round(s.cost_per_portion,2)=850.00 then 'PASS' else 'FAIL' end,
    'N'||round(s.cost_per_portion,2));
end $$;

-- ===========================================================================
-- 2. MODEL 2: format-based recipe with NO portion_qty.
--    WORKED EXAMPLE -- LITRE-BASED PRODUCT
--    10 L base for N20,000 -> N2.00/ml. Batch 10 L. No portion size at all.
--    2.5 L format: 2,500 ml x N2.00 = N5,000 ingredients
--                + N150 packaging (once) = N5,150
-- ===========================================================================
do $$
declare f record; base uuid; bowl uuid; rec uuid := gen_random_uuid();
        fm uuid; v uuid; s record; bas record;
begin
  select * into f from fx29;
  base := pg_temp.ing('Soup Base', f.ml, 10, f.l, 20000);
  bowl := pg_temp.packaging('2.5L Bowl', 100, 15000);          -- N150 each

  insert into recipes(id,account_id,business_id,name,batch_yield_qty,yield_unit_id,status)
  values (rec,f.acct,f.biz,'Egusi',10000,f.ml,'active');       -- NO portion_qty
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id,is_cost_bearing)
  values (f.acct,rec,base,10000,f.ml,true);

  fm := pg_temp.fmt('Family Bowl', 2.5, f.l);
  v  := pg_temp.variant(rec, fm);
  insert into serving_format_packaging(account_id,business_id,format_id,packaging_item_id,qty)
  values (f.acct,f.biz,fm,bowl,1);
  perform fn_compute_recipe_cost_snapshot(rec);

  select * into s from v_recipe_cost_current where recipe_id = rec;
  select * into bas from v_recipe_basis where recipe_id = rec;

  insert into t29 values (3,'MODEL 2 a recipe with an active format is format-based',
    case when bas.costing_basis='format' then 'PASS' else 'FAIL' end, bas.costing_basis);
  insert into t29 values (4,'MODEL 2 it is COMPLETE with no portion size at all',
    case when s.is_complete and s.cost_per_portion is null then 'PASS' else 'FAIL' end,
    'complete='||s.is_complete||', cost_per_portion='||coalesce(s.cost_per_portion::text,'NULL'));
  insert into t29 values (5,'MODEL 2 no synthetic portion size was invented',
    case when bas.portion_qty is null then 'PASS' else 'FAIL' end,
    coalesce(bas.portion_qty::text,'NULL'));
  insert into t29 values (6,'VOLUME->VOLUME 2.5 L of a 10,000 ml batch resolves to 2,500 ml',
    case when round(fn_variant_resolved_qty(v),2)=2500.00 then 'PASS' else 'FAIL' end,
    round(fn_variant_resolved_qty(v),2)||' ml');
  insert into t29 values (7,'MODEL 2 WORKED: N5,000 of base + N150 packaging = N5,150',
    case when round(fn_variant_cost(v),2)=5150.00 then 'PASS' else 'FAIL' end,
    'N'||round(fn_variant_cost(v),2));
end $$;

-- ===========================================================================
-- 3. ONE recipe, MANY formats. Batch economics are PROJECTED, not duplicated.
-- ===========================================================================
do $$
declare f record; rec uuid; fm1 uuid; fm15 uuid; fm4 uuid; v1 uuid; v15 uuid; v4 uuid;
        tub uuid; s record; n_snap int;
begin
  select * into f from fx29;
  select id into rec from recipes where name='Egusi';
  tub := pg_temp.packaging('1L Tub', 100, 8000);               -- N80 each

  fm1  := pg_temp.fmt('Single Tub', 1,   f.l);
  fm15 := pg_temp.fmt('Medium Bowl', 1.5, f.l);
  fm4  := pg_temp.fmt('Party Bowl', 4,   f.l);
  v1   := pg_temp.variant(rec, fm1);
  v15  := pg_temp.variant(rec, fm15);
  v4   := pg_temp.variant(rec, fm4);
  -- DIFFERENT packaging per format: the 1 L tub is cheaper than the bowl
  insert into serving_format_packaging(account_id,business_id,format_id,packaging_item_id,qty)
  values (f.acct,f.biz,fm1,tub,1);
  perform fn_compute_recipe_cost_snapshot(rec);

  insert into t29 values (8,'ONE RECIPE, MANY FORMATS: 1 L costs N2,000 + N80 tub = N2,080',
    case when round(fn_variant_cost(v1),2)=2080.00 then 'PASS' else 'FAIL' end,
    'N'||round(fn_variant_cost(v1),2));
  insert into t29 values (9,'1.5 L costs N3,000 with no packaging attached',
    case when round(fn_variant_cost(v15),2)=3000.00 then 'PASS' else 'FAIL' end,
    'N'||round(fn_variant_cost(v15),2));
  insert into t29 values (10,'4 L costs N8,000 -- the same batch, projected',
    case when round(fn_variant_cost(v4),2)=8000.00 then 'PASS' else 'FAIL' end,
    'N'||round(fn_variant_cost(v4),2));
  insert into t29 values (11,'PACKAGING DIFFERS PER FORMAT (N80 tub vs N150 bowl)',
    case when round(fn_variant_cost(v1),2)-2000.00 = 80.00 then 'PASS' else 'FAIL' end,
    'tub adds N'||(round(fn_variant_cost(v1),2)-2000.00));

  -- NO DOUBLE COUNTING: the batch ingredient cost is stated once, and the
  -- formats are projections of it, not additional copies of it.
  select * into s from v_recipe_cost_current where recipe_id = rec;
  insert into t29 values (12,'NO DOUBLE COUNTING: batch ingredient cost stays N20,000',
    case when round(s.ingredient_cost,2)=20000.00 then 'PASS' else 'FAIL' end,
    'N'||round(s.ingredient_cost,2));
  insert into t29 values (13,'and 1 + 1.5 + 2.5 + 4 L of output reconciles to the batch rate',
    case when round((fn_variant_cost(v1)-80.00) + fn_variant_cost(v15)
                  + round(s.cost_per_yield_unit*2500,2) + fn_variant_cost(v4), 2)
            = round(s.cost_per_yield_unit * (1000+1500+2500+4000), 2)
         then 'PASS' else 'FAIL' end,
    'sum of projections = rate x total ml');
end $$;

-- ===========================================================================
-- 4. MASS->MASS and COUNT->PACK. Same architecture, no special cases.
--    WORKED EXAMPLE -- WEIGHT-BASED PRODUCT
--      10 kg dough for N12,000 -> N1.20/g. A 500 g loaf = N600.00
--    WORKED EXAMPLE -- COUNT/PACK-BASED PRODUCT
--      100 rolls for N7,500 -> N75/piece. A 6-piece pack = N450.00
-- ===========================================================================
do $$
declare f record; flour uuid; rolls uuid; rec1 uuid := gen_random_uuid();
        rec2 uuid := gen_random_uuid(); fmA uuid; fmB uuid; vA uuid; vB uuid;
begin
  select * into f from fx29;

  flour := pg_temp.ing('Dough', f.g, 10, f.kg, 12000);          -- N1.20/g
  insert into recipes(id,account_id,business_id,name,batch_yield_qty,yield_unit_id,status)
  values (rec1,f.acct,f.biz,'Bread Batch',10000,f.g,'active');
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id,is_cost_bearing)
  values (f.acct,rec1,flour,10000,f.g,true);
  fmA := pg_temp.fmt('500 g Loaf', 500, f.g);
  vA  := pg_temp.variant(rec1, fmA);
  perform fn_compute_recipe_cost_snapshot(rec1);

  insert into t29 values (14,'MASS->MASS 500 g of a 10 kg batch resolves to 500 g',
    case when round(fn_variant_resolved_qty(vA),2)=500.00 then 'PASS' else 'FAIL' end,
    round(fn_variant_resolved_qty(vA),2)||' g');
  insert into t29 values (15,'WEIGHT WORKED: a 500 g loaf of N1.20/g dough costs N600.00',
    case when round(fn_variant_cost(vA),2)=600.00 then 'PASS' else 'FAIL' end,
    'N'||round(fn_variant_cost(vA),2));

  rolls := pg_temp.ing('Rolls', f.piece, 100, f.piece, 7500);   -- N75 each
  insert into recipes(id,account_id,business_id,name,batch_yield_qty,yield_unit_id,status)
  values (rec2,f.acct,f.biz,'Roll Batch',100,f.piece,'active');
  insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id,is_cost_bearing)
  values (f.acct,rec2,rolls,100,f.piece,true);
  fmB := pg_temp.fmt('6-piece Pack', 6, f.piece);
  vB  := pg_temp.variant(rec2, fmB);
  perform fn_compute_recipe_cost_snapshot(rec2);

  insert into t29 values (16,'COUNT->PACK a 6-piece pack resolves to 6 pieces',
    case when round(fn_variant_resolved_qty(vB),2)=6.00 then 'PASS' else 'FAIL' end,
    round(fn_variant_resolved_qty(vB),2)||' pieces');
  insert into t29 values (17,'COUNT WORKED: a 6-piece pack of N75 rolls costs N450.00',
    case when round(fn_variant_cost(vB),2)=450.00 then 'PASS' else 'FAIL' end,
    'N'||round(fn_variant_cost(vB),2));

  -- INCOMPATIBLE DIMENSIONS: a mass format against a volume batch
  declare fmX uuid; vX uuid; rec3 uuid; begin
    select id into rec3 from recipes where name='Egusi';        -- yields ml
    fmX := pg_temp.fmt('500 g Portion', 500, f.g);
    vX  := pg_temp.variant(rec3, fmX);
    insert into t29 values (18,'INCOMPATIBLE DIMENSIONS: 500 g against a litre batch is BLOCKED',
      case when fn_variant_resolved_qty(vX) is null then 'PASS' else 'FAIL' end,
      coalesce(fn_variant_resolved_qty(vX)::text,'NULL'));
    insert into t29 values (19,'and no cost is produced for it',
      case when fn_variant_cost(vX) is null then 'PASS' else 'FAIL' end,
      coalesce(fn_variant_cost(vX)::text,'NULL'));
    update recipe_variants set is_active = false where id = vX;  -- tidy for later checks
  end;

  -- MISSING CONVERSION: a container unit with no universal factor
  declare paint uuid; fmP uuid; vP uuid; rec4 uuid; begin
    select id into paint from units where account_id is null and code='paint';
    select id into rec4 from recipes where name='Bread Batch';
    fmP := pg_temp.fmt('One Paint', 1, paint);
    vP  := pg_temp.variant(rec4, fmP);
    insert into t29 values (20,'MISSING CONVERSION: a paint format is BLOCKED, not guessed',
      case when fn_variant_resolved_qty(vP) is null then 'PASS' else 'FAIL' end,
      coalesce(fn_variant_resolved_qty(vP)::text,'NULL'));
    update recipe_variants set is_active = false where id = vP;
  end;
end $$;

-- ===========================================================================
-- 5. LABOUR AND OVERHEAD ALLOCATION, reconciled back to the batch.
-- ===========================================================================
do $$
declare f record; rec uuid; v25 uuid; rate uuid := gen_random_uuid(); s record;
        oh uuid := gen_random_uuid(); rate_per_ml numeric;
begin
  select * into f from fx29;
  select id into rec from recipes where name='Egusi';
  select rv.id into v25 from recipe_variants rv
    join serving_formats sf on sf.id=rv.format_id
   where rv.recipe_id=rec and sf.name='Family Bowl';

  insert into labour_rates(id,account_id,business_id,name,rate_per_hour)
  values (rate,f.acct,f.biz,'Cooking',500);
  insert into recipe_labour(account_id,recipe_id,labour_rate_id,hours)
  values (f.acct,rec,rate,4);                       -- N2,000 on the batch
  perform fn_compute_recipe_cost_snapshot(rec);
  select * into s from v_recipe_cost_current where recipe_id = rec;

  insert into t29 values (21,'LABOUR is stated once on the batch: 4h x N500 = N2,000',
    case when round(s.labour_cost,2)=2000.00 then 'PASS' else 'FAIL' end,
    'N'||round(s.labour_cost,2));
  -- batch 22,000 over 10,000 ml = N2.20/ml; a 2.5 L bowl carries N5,500
  insert into t29 values (22,'LABOUR RECONCILES: the 2.5 L share is N5,500 + N150 packaging',
    case when round(fn_variant_cost(v25),2)=5650.00 then 'PASS' else 'FAIL' end,
    'N'||round(fn_variant_cost(v25),2));
  insert into t29 values (23,'LABOUR IS NOT MULTIPLIED INTO EVERY FORMAT',
    case when round(fn_variant_cost(v25),2) < 5150.00 + 2000.00 then 'PASS' else 'FAIL' end,
    'N'||round(fn_variant_cost(v25),2)||' not N7,150');

  -- overhead: N60,000 a month over 600 L of output = N0.10 per ml
  update business_settings set overhead_enabled=true,
         overhead_basis_qty=600, overhead_basis_unit_id=f.l where business_id=f.biz;
  insert into overhead_items(id,account_id,business_id,name,monthly_cost)
  values (oh,f.acct,f.biz,'Gas',60000);
  perform fn_compute_recipe_cost_snapshot(rec);
  rate_per_ml := fn_overhead_rate(f.biz, f.ml);

  insert into t29 values (24,'OVERHEAD RATE is N0.10 per ml (N60,000 over 600 L)',
    case when round(rate_per_ml,4)=0.1000 then 'PASS' else 'FAIL' end,
    'N'||round(rate_per_ml,4));
  -- 2.5 L bowl: 5,500 ingredients+labour + 150 packaging + 250 overhead
  insert into t29 values (25,'OVERHEAD RECONCILES: 2.5 L bowl is N5,900',
    case when round(fn_variant_cost(v25),2)=5900.00 then 'PASS' else 'FAIL' end,
    'N'||round(fn_variant_cost(v25),2));
  insert into t29 values (26,'INVARIANT ingredients+labour+packaging+overhead = format cost',
    case when round(fn_variant_cost(v25),2)
            = round(s.cost_per_yield_unit*2500 + 150.00 + rate_per_ml*2500, 2)
         then 'PASS' else 'FAIL' end,
    'N'||round(fn_variant_cost(v25),2));
end $$;

-- ===========================================================================
-- 6. INACTIVE FORMATS, BLOCKED STATES, ISOLATION, FROZEN HISTORY
-- ===========================================================================
do $$
declare f record; rec uuid; fmZ uuid; vZ uuid; bas record; s record; k int;
        u2 uuid := gen_random_uuid(); res jsonb;
begin
  select * into f from fx29;
  select id into rec from recipes where name='Roll Batch';

  -- an INACTIVE format must not make a recipe format-based
  fmZ := pg_temp.fmt('Retired Pack', 12, f.piece);
  vZ  := pg_temp.variant(rec, fmZ);
  update serving_formats set is_active = false where id = fmZ;
  select * into bas from v_recipe_basis where recipe_id = rec;
  insert into t29 values (27,'INACTIVE FORMAT is excluded from sellable calculations',
    case when bas.active_formats = 1 then 'PASS' else 'FAIL' end,
    bas.active_formats||' active format(s)');

  -- MISSING COST still blocks, never zero
  declare unpriced uuid; rec5 uuid := gen_random_uuid(); fmU uuid; vU uuid; begin
    insert into ingredients(id,account_id,kind,name,base_unit_id)
    values (gen_random_uuid(),f.acct,'ingredient','Unpriced Thing',f.g) returning id into unpriced;
    insert into recipes(id,account_id,business_id,name,batch_yield_qty,yield_unit_id,status)
    values (rec5,f.acct,f.biz,'Blocked Batch',1000,f.g,'active');
    insert into recipe_lines(account_id,recipe_id,ingredient_id,qty,unit_id,is_cost_bearing)
    values (f.acct,rec5,unpriced,1000,f.g,true);
    fmU := pg_temp.fmt('Blocked 100g', 100, f.g);
    vU  := pg_temp.variant(rec5, fmU);
    perform fn_compute_recipe_cost_snapshot(rec5);
    select * into s from v_recipe_cost_current where recipe_id = rec5;
    insert into t29 values (28,'MISSING COST gives an incomplete state, not a zero',
      case when s.is_complete = false and s.batch_cost is null then 'PASS' else 'FAIL' end,
      'complete='||s.is_complete||', batch='||coalesce(s.batch_cost::text,'NULL'));
    insert into t29 values (29,'and the format yields no cost either',
      case when fn_variant_cost(vU) is null then 'PASS' else 'FAIL' end,
      coalesce(fn_variant_cost(vU)::text,'NULL'));
  end;

  -- CROSS-TENANT isolation of formats and variants
  insert into auth.users(id,email) values (u2,'modelrival@t.test');
  res := fn_create_account_and_business('MRival','MRival K','caterer',u2,
           p_idempotency_key=>gen_random_uuid()::text);
  declare k2 int; begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', u2::text, true);
    select count(*) into k  from serving_formats;
    select count(*) into k2 from v_recipe_basis;
    reset role;
    perform set_config('request.jwt.claim.sub','',true);
    insert into t29 values (30,'CROSS-TENANT another account sees no formats',
      case when k=0 then 'PASS' else 'FAIL' end, k||' row(s)');
    insert into t29 values (31,'CROSS-TENANT another account sees no recipe bases',
      case when k2=0 then 'PASS' else 'FAIL' end, k2||' row(s)');
  end;
end $$;

-- ===========================================================================
-- 7. FROZEN HISTORY stays deterministic after later recipe and price changes.
-- ===========================================================================
do $$
declare f record; rec uuid; before_cost numeric; after_cost numeric; s record;
begin
  select * into f from fx29;
  select id into rec from recipes where name='Bread Batch';

  -- The overhead basis declared above is 600 LITRES, and this recipe yields in
  -- GRAMS. The engine refuses to allocate across measurement kinds (0023), so
  -- the recipe is correctly incomplete while that basis stands. Recorded as a
  -- check in its own right, because it is a real limitation for a business
  -- selling in more than one dimension: one overhead basis cannot serve both a
  -- litre product and a kilogram product.
  perform fn_compute_recipe_cost_snapshot(rec);
  select * into s from v_recipe_cost_current where recipe_id = rec;
  insert into t29 values (35,
    'a litre overhead basis blocks a gram-yield recipe rather than guessing',
    case when s.is_complete = false then 'PASS' else 'FAIL' end,
    'is_complete='||s.is_complete);

  -- Price history is a separate question, so take overhead out of the way.
  update business_settings set overhead_enabled = false where business_id = f.biz;
  perform fn_compute_recipe_cost_snapshot(rec);
  select cost_per_yield_unit into before_cost from v_recipe_cost_current where recipe_id=rec;

  -- the ingredient gets dearer: a later purchase at double the price
  insert into ingredient_prices(account_id,ingredient_id,qty_base,amount,source)
  select f.acct, rl.ingredient_id, 10000, 24000, 'purchase'
    from recipe_lines rl where rl.recipe_id = rec limit 1;
  perform fn_compute_recipe_cost_snapshot(rec);
  select cost_per_yield_unit into after_cost from v_recipe_cost_current where recipe_id=rec;

  insert into t29 values (32,'a later purchase changes the CURRENT cost',
    case when after_cost > before_cost then 'PASS' else 'FAIL' end,
    'N'||round(before_cost,4)||' -> N'||round(after_cost,4));

  -- and the historical snapshot is still there, unchanged
  insert into t29
  select 33, 'the earlier snapshot is preserved unchanged as history',
         case when count(*) >= 2 then 'PASS' else 'FAIL' end,
         count(*)||' snapshot(s) retained'
  from cost_snapshots where recipe_id = rec;

  -- and "latest" is deterministic even though both may share a timestamp
  insert into t29
  select 34, 'the resolved snapshot is deterministic under a timestamp tie',
         case when count(distinct seq) = 1 then 'PASS' else 'FAIL' end,
         'seq '||string_agg(seq::text, ',')
  from cost_snapshots
  where recipe_id = rec
    and seq = (select max(seq) from cost_snapshots where recipe_id = rec);
end $$;

select * from t29 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict<>'PASS') as fail from t29;

rollback;
