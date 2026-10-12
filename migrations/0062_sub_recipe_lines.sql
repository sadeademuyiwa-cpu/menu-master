-- ============================================================================
-- MENU MASTER NG
-- 0062: a dish made from another dish shows up in its ingredient list
--
-- Requires: 0001-0061 applied.
--
-- WHY
--   recipe_lines has carried sub_recipe_id since 0001 and the engine
--   (fn__recipe_cost_core, 0007) has always costed such a line from the other
--   dish's batch. Nothing in the app could add one, so nobody noticed that
--   v_recipe_line_costs (0034) calls fn_ingredient_cost_basis with the line's
--   ingredient_id, which is NULL for a sub-recipe line -- and that function
--   raises "Ingredient does not belong to this account". The whole view then
--   errors for that recipe, and the app shows "Nothing in this recipe yet"
--   under a dish that is costed. Phase 3 adds the screen; this makes the view
--   survive what the screen adds.
--
-- HOW
--   v_recipe_line_costs is REBUILT with the same 22 columns. The purchase
--   evidence (fn_ingredient_cost_basis) is only looked up when the line has an
--   ingredient. A sub-recipe line reports the other dish's name as item_name
--   (as before), and now also its line_cost: the quantity converted into the
--   other dish's yield unit, times that dish's current cost per yield unit --
--   the same two figures the engine multiplies. NULL where either is unknown.
--   problem stays 'sub_recipe' (the app says "Made from another dish").
--
-- WHAT DOES NOT CHANGE
--   No policy (118), no function (98). The engine is untouched: batch costs
--   are what they were; only the per-line view stops failing.
-- ============================================================================

drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0062 ABORT: this executor is not honouring transaction control '
      '(each statement is committing on its own). Run it with '
      'psql --single-transaction over the Session Pooler.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='order_lines' and column_name='extra_unit_cost') then
    raise exception '0062 preflight FAILED: order_lines.extra_unit_cost is missing. Apply 0061 first.';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 118 then
    raise exception '0062 preflight FAILED: policy count is %, expected 118.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 98 then
    raise exception '0062 preflight FAILED: fn_* count is %, expected 98.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  if (select count(*) from information_schema.columns where table_name='v_recipe_line_costs') <> 22 then
    raise exception '0062 preflight FAILED: v_recipe_line_costs has % columns, expected 22.',
      (select count(*) from information_schema.columns where table_name='v_recipe_line_costs');
  end if;
end
$$;

create or replace view v_recipe_line_costs with (security_invoker = on) as
select
  rl.id                              as line_id,
  rl.recipe_id,
  rl.account_id,
  r.business_id,
  rl.ingredient_id,
  rl.sub_recipe_id,
  coalesce(i.name, sr.name)          as item_name,
  i.kind                             as item_kind,
  rl.is_cost_bearing,
  rl.exclusion_reason,

  rl.qty                             as recipe_qty,
  u.code                             as recipe_unit,
  coalesce(bu.code, su.code)         as base_unit,

  case when rl.ingredient_id is not null
       then fn_resolve_qty_to_base(rl.ingredient_id, rl.qty, rl.unit_id)
       else fn_convert_between_units(rl.qty, rl.unit_id, sr.yield_unit_id)
  end                                as base_qty,
  case when rl.ingredient_id is not null
       then fn_ingredient_usable_unit_cost(rl.ingredient_id, r.business_id)
       else sc.cost_per_yield_unit
  end                                as unit_cost,

  case when not rl.is_cost_bearing then null
       when rl.ingredient_id is not null then
         fn_resolve_qty_to_base(rl.ingredient_id, rl.qty, rl.unit_id)
           * fn_ingredient_usable_unit_cost(rl.ingredient_id, r.business_id)
       else
         fn_convert_between_units(rl.qty, rl.unit_id, sr.yield_unit_id) * sc.cost_per_yield_unit
  end                                as line_cost,

  (ev.b).qty_base                    as purchase_qty_base,
  (ev.b).amount                      as purchase_amount,
  (ev.b).to_date                     as purchase_date,
  (ev.b).purchase_count              as purchase_count,
  (ev.b).basis                       as cost_basis,

  case
    when not rl.is_cost_bearing                                              then 'excluded'
    when rl.sub_recipe_id is not null                                        then 'sub_recipe'
    when fn_resolve_qty_to_base(rl.ingredient_id, rl.qty, rl.unit_id) is null then 'missing_conversion'
    when fn_ingredient_usable_unit_cost(rl.ingredient_id, r.business_id) is null then 'missing_price'
    else                                                                          'ok'
  end                                as problem

from recipe_lines rl
join recipes r      on r.id = rl.recipe_id and r.deleted_at is null
left join ingredients i on i.id = rl.ingredient_id
left join recipes sr    on sr.id = rl.sub_recipe_id
left join units u       on u.id = rl.unit_id
left join units bu      on bu.id = i.base_unit_id
left join units su      on su.id = sr.yield_unit_id
-- The other dish's current cost, where this line is made from one.
left join v_recipe_cost_current sc on sc.recipe_id = rl.sub_recipe_id and sc.is_complete
-- Purchase evidence only for an ingredient line. fn_ingredient_cost_basis
-- raises for a NULL ingredient, and that error used to take the whole view
-- down for the recipe. A LATERAL with a WHERE still calls the function; a
-- CASE does not evaluate the branch it does not take, so the one row the
-- function returns is fetched as a composite only when there is an
-- ingredient, and unpacked above.
cross join lateral (
  select case when rl.ingredient_id is not null
              then fn_ingredient_cost_basis(rl.ingredient_id, r.business_id) end as b
) ev;

comment on view v_recipe_line_costs is
  'Per-line cost contribution and the evidence behind each unit cost, both '
  'from the same PostgreSQL functions the engine uses. A line made from '
  'another dish is costed from that dish''s current cost per yield unit. '
  'Adds no costing rule. NULL means unknown and is never rendered as zero.';

grant select on v_recipe_line_costs to authenticated;

do $$
declare v_inv boolean; v_cols int;
begin
  select 'security_invoker=on' = any(reloptions) into v_inv
    from pg_class where relname = 'v_recipe_line_costs';
  if not coalesce(v_inv, false) then
    raise exception '0062 self-check FAILED: the view is not security_invoker.';
  end if;
  select count(*) into v_cols from information_schema.columns where table_name = 'v_recipe_line_costs';
  if v_cols <> 22 then
    raise exception '0062 self-check FAILED: view has % columns, expected 22.', v_cols;
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 118 then
    raise exception '0062 self-check FAILED: 0062 must add no policy.';
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 98 then
    raise exception '0062 self-check FAILED: fn_* count is %, expected 98.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  raise notice '0062 OK: v_recipe_line_costs survives a sub-recipe line and costs it; 22 columns, 118 policies, 98 fn_*.';
end
$$;
