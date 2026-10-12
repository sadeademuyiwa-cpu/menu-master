-- ============================================================================
-- 0062 ROLLBACK: back at 0061. Restores the 0034 v_recipe_line_costs byte
-- for byte. A dish with a line made from another dish then loses its
-- ingredient list in the app again (the view errors), which is the state
-- 0062 fixed; its cost is unaffected.
-- ============================================================================
drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0062 rollback ABORT: this executor is not honouring transaction control. '
      'Run it with psql --single-transaction.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if (select pg_get_viewdef('v_recipe_line_costs'::regclass) not like '%rl.ingredient_id IS NOT NULL%') then
    raise exception '0062 rollback: v_recipe_line_costs is the 0034 version; 0062 is not applied.';
  end if;
end
$$;

-- Byte-faithful to 0034.
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
  bu.code                            as base_unit,

  fn_resolve_qty_to_base(rl.ingredient_id, rl.qty, rl.unit_id) as base_qty,
  fn_ingredient_usable_unit_cost(rl.ingredient_id, r.business_id) as unit_cost,

  case when rl.is_cost_bearing then
    fn_resolve_qty_to_base(rl.ingredient_id, rl.qty, rl.unit_id)
      * fn_ingredient_usable_unit_cost(rl.ingredient_id, r.business_id)
  end                                as line_cost,

  b.qty_base                         as purchase_qty_base,
  b.amount                           as purchase_amount,
  b.to_date                          as purchase_date,
  b.purchase_count                   as purchase_count,
  b.basis                            as cost_basis,

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
left join lateral (
  select * from fn_ingredient_cost_basis(rl.ingredient_id, r.business_id)
) b on true;

comment on view v_recipe_line_costs is
  'Per-line cost contribution and the evidence behind each unit cost, both '
  'from the same PostgreSQL functions the engine uses. Adds no costing rule. '
  'NULL means unknown and is never rendered as zero.';

grant select on v_recipe_line_costs to authenticated;

do $$
begin
  if (select count(*) from information_schema.columns where table_name='v_recipe_line_costs') <> 22 then
    raise exception '0062 rollback FAILED: view column count moved.';
  end if;
  raise notice '0062 rollback OK: back at 0061.';
end
$$;
