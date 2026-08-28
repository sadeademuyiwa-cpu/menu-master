-- ============================================================================
-- MENU MASTER NG
-- 0033: per-line recipe cost, as a view
--
-- Authority: Recipe Costing Experience sprint, section 3 (the recipe page must
-- show what each ingredient contributes) and rule 7 (no frontend-only financial
-- calculation may diverge from PostgreSQL).
--
-- Requires: 0001-0032 applied.
--
-- WHY A VIEW AND NOT ARITHMETIC IN THE PAGE
--   The page needs one figure the engine has never exposed: what THIS line
--   contributes. The engine computes it as
--       fn_resolve_qty_to_base(...) * fn_ingredient_usable_unit_cost(...)
--   inside fn__recipe_cost_core (0007 lines 203-226). Doing that multiplication
--   in TypeScript would be a second implementation of the same arithmetic, and
--   the two would drift the first time either changed. This view performs it in
--   the same place, with the same two functions, so there is one implementation.
--
--   IT ADDS NO NEW COSTING RULE. Every number comes from a function that already
--   existed; the view only exposes the intermediate the engine already computes
--   and then discards into a total.
--
-- READ ONLY. No table, no column, no policy, no function is created or altered.
-- security_invoker, so RLS applies to the caller exactly as it does to the
-- underlying tables: a member sees their own lines, cost-blind roles see none.
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_class where relname = 'v_recipe_line_costs') then
    raise exception '0033 preflight FAILED: v_recipe_line_costs already exists.';
  end if;
  if not exists (select 1 from pg_proc where proname = 'fn_ingredient_usable_unit_cost') then
    raise exception '0033 preflight FAILED: the costing engine is missing.';
  end if;
  -- Assert the BASELINE before creating anything. This check used to sit at the
  -- end, next to the security_invoker check. Under Supabase's SQL editor the
  -- whole file is one transaction, so a refusal rolled the view back; under
  -- plain psql (autocommit) it did not, and a refused migration still left the
  -- view behind. A baseline assertion belongs before the DDL under either.
  if (select count(*) from pg_policies where schemaname = 'public') <> 116 then
    raise exception '0033 preflight FAILED: policy count is %, expected 116 '
                    '(migrations 0001-0032). This is not the expected baseline.',
                    (select count(*) from pg_policies where schemaname = 'public');
  end if;
end
$$;

create view v_recipe_line_costs with (security_invoker = on) as
select
  rl.id                              as line_id,
  rl.recipe_id,
  rl.account_id,
  r.business_id,
  rl.ingredient_id,
  rl.sub_recipe_id,
  coalesce(i.name, sr.name)          as item_name,
  i.kind                             as item_kind,          -- ingredient | packaging
  rl.is_cost_bearing,
  rl.exclusion_reason,

  rl.qty                             as recipe_qty,
  u.code                             as recipe_unit,
  bu.code                            as base_unit,

  -- The resolved quantity, in the ingredient's base unit. NULL means the
  -- conversion does not exist -- the blocker, never a guess.
  fn_resolve_qty_to_base(rl.ingredient_id, rl.qty, rl.unit_id) as base_qty,

  -- The usable cost per base unit, after purchase yield. NULL means no price
  -- has been entered for this item.
  fn_ingredient_usable_unit_cost(rl.ingredient_id, r.business_id) as unit_cost,

  -- What this line contributes to the batch. NULL if either input is NULL:
  -- an unknown multiplied by anything stays unknown, and is never shown as 0.
  case when rl.is_cost_bearing then
    fn_resolve_qty_to_base(rl.ingredient_id, rl.qty, rl.unit_id)
      * fn_ingredient_usable_unit_cost(rl.ingredient_id, r.business_id)
  end                                as line_cost,

  -- The most recent purchase behind that unit cost, so the page can show the
  -- customer their own evidence: "50 kg for 85,000 = 1,700 per kg".
  p.qty_base                         as purchase_qty_base,
  p.amount                           as purchase_amount,
  p.effective_date                   as purchase_date,

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
  select ip.qty_base, ip.amount, ip.effective_date
    from ingredient_prices ip
   where ip.ingredient_id = rl.ingredient_id
   order by ip.effective_date desc, ip.created_at desc
   limit 1
) p on true;

comment on view v_recipe_line_costs is
  'Per-line cost contribution, computed by the same two functions the costing '
  'engine uses. Adds no costing rule of its own. NULL means unknown and is '
  'never rendered as zero.';

grant select on v_recipe_line_costs to authenticated;

-- ----------------------------------------------------------------------------
-- SELF-CHECK
-- ----------------------------------------------------------------------------
do $$
declare v_inv boolean; v_pol int;
begin
  select 'security_invoker=on' = any(reloptions) into v_inv
    from pg_class where relname = 'v_recipe_line_costs';
  if not coalesce(v_inv, false) then
    raise exception '0033 self-check FAILED: the view is not security_invoker. '
                    'It would read across tenants.';
  end if;

  -- The baseline was asserted in the preflight; this confirms the migration
  -- itself changed nothing.
  select count(*) into v_pol from pg_policies where schemaname = 'public';
  if v_pol <> 116 then
    raise exception '0033 self-check FAILED: policy count moved to % during this '
                    'migration. It must not touch policies.', v_pol;
  end if;

  raise notice '0033 OK: v_recipe_line_costs created, security_invoker, 116 policies unchanged.';
end
$$;
