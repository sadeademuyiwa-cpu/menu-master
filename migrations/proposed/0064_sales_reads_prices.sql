-- ============================================================================
-- MENU MASTER NG
-- 0064: sales staff see what each dish sells for, and nothing it costs
--
-- Requires: 0001-0063 applied.
--
-- WHY
--   0004 put recipe_prices behind fn_can_see_costs ("selling prices and
--   margins are cost adjacent"), so the sales and kitchen roles read no price
--   at all. The New sale menu reads selling_price from v_product_attention,
--   which inherits that rule, so a sales helper sees "No price yet" on every
--   dish and types each price by hand. The owner has ruled (16 Oct 2026,
--   decision 1 of branding/09-uiux/04-simplify-plan.md): sales staff may see
--   current SELLING PRICES, never a cost, a profit, a margin or a suggested
--   price. Kitchen stays as it is.
--
-- HOW
--   fn_menu_prices()   SECURITY DEFINER, search_path pinned to public.
--                      Returns business_id, recipe_id, variant_id, channel_id
--                      and selling_price, and nothing else: no cost, profit,
--                      margin, markup, target or recommended price is
--                      computed or returned.
--                      One row per dish, per active size (or the dish itself
--                      when it has none), per active channel -- the rows
--                      v_price_check lists -- with the price chosen by the
--                      same rule v_price_check uses (0037): a size's own
--                      price before the dish's, then the latest effective
--                      date on or before today, then the latest entered. A
--                      dish with no price is a row with a NULL price: missing
--                      stays missing, never zero.
--                      Only for accounts where the caller is owner, manager,
--                      sales or accountant (fn_has_account_role, the check
--                      every write policy uses). Kitchen, a stranger and a
--                      logged-out caller get no row.
--
-- WHAT DOES NOT CHANGE
--   recipe_prices keeps its four 0004/0028 policies: sales still cannot read
--   the table, its history or who set a price. v_price_check and
--   v_product_attention are untouched, so a sales member still sees no cost
--   in them. No policy (118). fn_* 98 -> 99. No customer row.
-- ============================================================================

drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0064 ABORT: this executor is not honouring transaction control '
      '(each statement is committing on its own). Run it with '
      'psql --single-transaction over the Session Pooler.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='recipes' and column_name='photo_path') then
    raise exception '0064 preflight FAILED: recipes.photo_path is missing. Apply 0063 first.';
  end if;
  if to_regprocedure('public.fn_has_account_role(uuid, public.member_role[])') is null then
    raise exception '0064 preflight FAILED: fn_has_account_role is missing (0004).';
  end if;
  if exists (select 1 from pg_proc where proname='fn_menu_prices' and pronamespace='public'::regnamespace) then
    raise exception '0064 preflight FAILED: fn_menu_prices already exists.';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='recipe_prices'
                   and policyname='p_recipe_prices_select' and qual like '%fn_can_see_costs%') then
    raise exception '0064 preflight FAILED: recipe_prices is not cost-gated for reading as 0004 left it.';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 118 then
    raise exception '0064 preflight FAILED: policy count is %, expected 118.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 98 then
    raise exception '0064 preflight FAILED: fn_* count is %, expected 98.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. The menu's prices
-- ---------------------------------------------------------------------------
-- A function rather than a policy on recipe_prices: a policy would open every
-- row of the table, with its history and set_by, and every view built on it.
-- This returns one figure per sellable thing and has no column a cost could
-- leak through. It reads no cost table at all.
create or replace function fn_menu_prices()
returns table (business_id uuid, recipe_id uuid, variant_id uuid, channel_id uuid, selling_price numeric)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  with mine as (
    -- The caller's accounts in which they may see what a dish sells for:
    -- everyone fn_can_see_costs admits, plus sales. Kitchen is left out on
    -- purpose (the owner's ruling). auth.uid() is NULL for a logged-out or
    -- service caller, so they match no membership.
    select distinct m.account_id
      from memberships m
     where m.user_id = auth.uid()
       and fn_has_account_role(m.account_id,
             array['owner','manager','sales','accountant']::member_role[])
  ),
  items as (
    -- The sellable rows of v_price_check (0037): a dish in each active size,
    -- or the dish itself when it has no active size.
    select r.business_id, r.id as recipe_id, rv.id as variant_id
      from recipes r
      join mine on mine.account_id = r.account_id
      join recipe_variants rv on rv.recipe_id = r.id and rv.is_active
     where r.kind = 'dish' and r.deleted_at is null
    union all
    select r.business_id, r.id, null::uuid
      from recipes r
      join mine on mine.account_id = r.account_id
     where r.kind = 'dish' and r.deleted_at is null
       and not exists (select 1 from recipe_variants rv2 where rv2.recipe_id = r.id and rv2.is_active)
  )
  select x.business_id, x.recipe_id, x.variant_id, ch.id, p.price
    from items x
    left join channels ch on ch.business_id = x.business_id and ch.is_active
    -- The same choice v_price_check makes, so the price a helper is offered
    -- is the price the owner sees. tests/050 holds the two to each other.
    left join lateral (
      select rp.price
        from recipe_prices rp
       where rp.recipe_id = x.recipe_id
         and (rp.channel_id is null or rp.channel_id = ch.id)
         and (rp.variant_id is null or rp.variant_id = x.variant_id)
         and rp.effective_from <= current_date
       order by (rp.variant_id is not null) desc, rp.effective_from desc, rp.created_at desc
       limit 1
    ) p on true;
$fn$;

comment on function fn_menu_prices() is
  'Current selling price of every dish (and size, and channel) the caller may sell, '
  'for owner, manager, sales and accountant; no row for kitchen or a non-member. '
  'Selling prices only: no cost, profit, margin or recommended price. NULL means '
  'no price is recorded yet.';

revoke all on function fn_menu_prices() from public, anon;
grant execute on function fn_menu_prices() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Self-check
-- ---------------------------------------------------------------------------
do $$
declare v_oid oid := to_regprocedure('public.fn_menu_prices()');
begin
  if v_oid is null then
    raise exception '0064 self-check FAILED: fn_menu_prices() is missing.';
  end if;
  if not (select prosecdef and provolatile = 's' from pg_proc where oid = v_oid) then
    raise exception '0064 self-check FAILED: fn_menu_prices is not a STABLE SECURITY DEFINER function.';
  end if;
  if not exists (select 1 from pg_proc p where p.oid = v_oid
                   and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public')) then
    raise exception '0064 self-check FAILED: fn_menu_prices does not pin search_path.';
  end if;
  if has_function_privilege('anon', v_oid, 'execute')
     or exists (select 1 from pg_proc p, unnest(p.proacl) a
                 where p.oid = v_oid and a::text like '=%') then
    raise exception '0064 self-check FAILED: fn_menu_prices is executable by a logged-out caller or by PUBLIC.';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception '0064 self-check FAILED: a signed-in user cannot call fn_menu_prices.';
  end if;
  if (select array_to_string(array_agg(n order by o), ',')
        from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
       where p.oid = v_oid and m = 't') <> 'business_id,recipe_id,variant_id,channel_id,selling_price' then
    raise exception '0064 self-check FAILED: fn_menu_prices returns columns other than the five selling-price columns.';
  end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='recipe_prices') <> 4
     or not exists (select 1 from pg_policies where schemaname='public' and tablename='recipe_prices'
                      and policyname='p_recipe_prices_select' and qual like '%fn_can_see_costs%') then
    raise exception '0064 self-check FAILED: recipe_prices is no longer cost-gated as 0004 left it.';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 118 then
    raise exception '0064 self-check FAILED: 0064 must add no policy.';
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 99 then
    raise exception '0064 self-check FAILED: fn_* count is %, expected 99.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  raise notice '0064 OK: fn_menu_prices() gives owner, manager, sales and accountant the current '
               'selling prices, and nothing cost-like; recipe_prices still cost-gated; 118 policies, 99 fn_*.';
end
$$;
