-- ============================================================================
-- MENU MASTER NG -- tests/052_trial_gate.sql
--
-- Acceptance test for 0066. Run on a database with 0066 applied.
-- Rolls everything back.
--
-- Once a trial has ended nothing new is saved through the elevated
-- functions, and on the Costing plan nothing touches sales -- except money
-- received on a sale already confirmed, which every sale role can still
-- record. Member management stays open. Onboarding gives exactly the
-- advertised trial, to a login that belongs to no account. A trial ends at
-- 23:59:59 Lagos time on its 14th day. Custom units belong to the roles that
-- edit ingredients, while the account has access.
--
-- Three accounts, each with all five roles:
--   E  ended: its trial's current_period_end moved one minute into the past
--   L  live:  the positive control, a trial in progress
--   C  paid Costing: entitled, without Sales
-- Every probe that would change something runs inside pg_temp.try (or
-- try_msg, try_gate), which rolls the change back, so every role meets the
-- same state. A trial or plan refusal must come from the function's OWN gate
-- (try_gate reads the error context), not from a gated function it calls.
-- Recording a payment refuses with SQLSTATE MMPAY and a plain sentence (X5).
-- Behaviour only: global fn_* and policy totals belong to POST_VERIFY_0066.
-- ============================================================================

begin;

create temp table t52 (n int, check_name text, verdict text, detail text) on commit drop;

create or replace function pg_temp.u(n int) returns uuid language sql immutable as
$$ select ('00000052-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

insert into auth.users (id, email)
select pg_temp.u(n), 'u' || n || '@t52.test'
  from unnest(array[1,2,3,4,5, 11,12,13,14,15, 21,22,23,24,25, 31,32,33,34,35,36,37,38]) n;
-- 1-5 E, 11-15 L, 21-25 C (owner, manager, kitchen, sales, accountant)
-- 31 stranger, 32 and 35 newcomers, 33 and 38 on two accounts, 34 a removed
-- member, 36 invited to E, 37 for the operator

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
end $$;

-- Runs p_sql as p_user (or as the operator when p_user is null) and undoes
-- whatever it did. 'ok' when it ran through; the SQLSTATE when it was refused.
create or replace function pg_temp.try(p_user uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
    if p_user is not null then perform set_config('role', 'authenticated', true); end if;
    execute p_sql;
    raise exception 'probe rolled back' using errcode = 'MM000';
  exception when others then v := sqlstate;
  end;
  return case when v = 'MM000' then 'ok' else v end;
end $$;

-- The same, returning SQLSTATE | HINT | message.
create or replace function pg_temp.try_msg(p_user uuid, p_sql text) returns text language plpgsql as $$
declare v text; h text; m text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
    if p_user is not null then perform set_config('role', 'authenticated', true); end if;
    execute p_sql;
    raise exception 'probe rolled back' using errcode = 'MM000';
  exception when others then
    get stacked diagnostics v = returned_sqlstate, h = pg_exception_hint, m = message_text;
  end;
  return v || '|' || coalesce(h, '') || '|' || m;
end $$;

-- Like try, but a trial or plan refusal also names the function that called
-- the gate DIRECTLY: 'MMENT@fn_void_order'. The SQLSTATE alone would not prove
-- that a function has its own gate line: a purchase writes ingredient_prices,
-- whose trigger re-costs through the gated fn_recompute_recipes_for_ingredient,
-- and the re-costing functions call the gated snapshot functions, so a
-- function without its line would still be refused, by the one it calls.
create or replace function pg_temp.try_gate(p_user uuid, p_sql text) returns text language plpgsql as $$
declare v text; c text; l text[]; caller text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
    if p_user is not null then perform set_config('role', 'authenticated', true); end if;
    execute p_sql;
    raise exception 'probe rolled back' using errcode = 'MM000';
  exception when others then
    get stacked diagnostics v = returned_sqlstate, c = pg_exception_context;
  end;
  if v = 'MM000' then return 'ok'; end if;
  if v not in ('MMENT', 'MMSAL') then return v; end if;
  -- the context lists the frames innermost first; the first PL/pgSQL frame
  -- after the gate's own is the function that called it
  l := regexp_split_to_array(coalesce(c, ''), E'\n');
  for i in 1 .. coalesce(array_length(l, 1), 0) loop
    if l[i] ~ '^PL/pgSQL function (\w+\.)?fn_require_entitled\(' then
      for j in i + 1 .. array_length(l, 1) loop
        caller := substring(l[j] from '^PL/pgSQL function (?:\w+\.)?(\w+)\(');
        exit when caller is not null;
      end loop;
      exit;
    end if;
  end loop;
  return v || '@' || coalesce(caller, '?');
end $$;

-- ============================================ 0. fixture
create temp table fx_acct (k text primary key, ord int, label text, acct uuid, biz uuid) on commit drop;
insert into fx_acct
select 'E', 1, 'ended-trial', (e->>'account_id')::uuid, (e->>'business_id')::uuid
  from fn_create_account_and_business('T52 Ended','T52 Ended Kitchen','caterer', pg_temp.u(1),
                                      p_idempotency_key => 't52-e') e
union all
select 'L', 2, 'live-trial', (l->>'account_id')::uuid, (l->>'business_id')::uuid
  from fn_create_account_and_business('T52 Live','T52 Live Kitchen','caterer', pg_temp.u(11),
                                      p_idempotency_key => 't52-l') l
union all
select 'C', 3, 'paid Costing', (c->>'account_id')::uuid, (c->>'business_id')::uuid
  from fn_create_account_and_business('T52 Costing','T52 Costing Kitchen','caterer', pg_temp.u(21),
                                      p_idempotency_key => 't52-c') c;

create temp table fx_member (acct uuid, k text, ord int, role text, uid uuid) on commit drop;
insert into fx_member
select a.acct, a.k, r.ord, r.role, pg_temp.u(r.ord + case a.k when 'E' then 0 when 'L' then 10 else 20 end)
  from fx_acct a,
       (values (1,'owner'),(2,'manager'),(3,'kitchen'),(4,'sales'),(5,'accountant')) r(ord, role);
insert into memberships (account_id, user_id, role)
select acct, uid, role::member_role from fx_member where role <> 'owner';

create temp table fx_obj (acct uuid primary key, biz uuid, rice uuid, dish uuid, variant uuid, unit uuid,
                          draft_purchase uuid, posted_purchase uuid,
                          draft_order uuid, confirmed_order uuid, voided_order uuid, sales_entry uuid)
  on commit drop;

-- Built as the operator (no signed-in user), while every account is on trial.
do $$
declare
  a record; g uuid; kg uuid; v_rice uuid; v_dish uuid; v_fmt uuid; v_var uuid; v_unit uuid;
  v_dp uuid; v_pp uuid; v_do uuid; v_co uuid; v_vo uuid; v_se uuid;
begin
  perform pg_temp.as_user(null);
  select id into g  from units where account_id is null and code = 'g';
  select id into kg from units where account_id is null and code = 'kg';
  for a in select * from fx_acct order by ord loop
    insert into ingredients (account_id, kind, name, base_unit_id)
    values (a.acct, 'ingredient', 'T52 Rice', g) returning id into v_rice;
    insert into ingredient_prices (account_id, ingredient_id, qty_base, amount, source)
    values (a.acct, v_rice, 50000, 85000, 'purchase');
    insert into recipes (account_id, business_id, name, batch_yield_qty, yield_unit_id, portion_qty, status)
    values (a.acct, a.biz, 'T52 Jollof', 4500, g, 500, 'active') returning id into v_dish;
    insert into recipe_lines (account_id, recipe_id, ingredient_id, qty, unit_id, is_cost_bearing)
    values (a.acct, v_dish, v_rice, 4500, g, true);
    perform fn_compute_recipe_cost_snapshot(v_dish);
    insert into serving_formats (account_id, business_id, name, capacity_qty, capacity_unit_id)
    values (a.acct, a.biz, 'T52 Bowl', 500, g) returning id into v_fmt;
    insert into recipe_variants (account_id, business_id, recipe_id, format_id, costing_basis)
    values (a.acct, a.biz, v_dish, v_fmt, 'capacity') returning id into v_var;
    perform fn_compute_variant_cost_snapshot(v_var);
    insert into units (account_id, code, name, kind, factor_to_base)
    values (a.acct, 't52paint', 'T52 Paint', 'container', 1) returning id into v_unit;

    -- a draft purchase, and one already recorded
    insert into purchases (account_id, business_id, purchase_date, reference)
    values (a.acct, a.biz, current_date, 'T52-DRAFT') returning id into v_dp;
    insert into purchase_lines (account_id, purchase_id, ingredient_id, qty, unit_id, amount)
    values (a.acct, v_dp, v_rice, 50, kg, 90000);
    insert into purchases (account_id, business_id, purchase_date, reference)
    values (a.acct, a.biz, current_date - 1, 'T52-POSTED') returning id into v_pp;
    insert into purchase_lines (account_id, purchase_id, ingredient_id, qty, unit_id, amount)
    values (a.acct, v_pp, v_rice, 50, kg, 88000);
    perform fn_post_purchase(v_pp);

    -- a draft sale, a confirmed sale with a deposit, a cancelled sale, a legacy entry
    insert into orders (account_id, business_id, order_no, order_date)
    values (a.acct, a.biz, 'T52-D', current_date) returning id into v_do;
    insert into order_lines (account_id, order_id, recipe_id, qty, unit_price)
    values (a.acct, v_do, v_dish, 2, 5000);
    insert into orders (account_id, business_id, order_no, order_date)
    values (a.acct, a.biz, 'T52-C', current_date) returning id into v_co;
    insert into order_lines (account_id, order_id, recipe_id, qty, unit_price)
    values (a.acct, v_co, v_dish, 10, 5000);
    perform fn_confirm_order(v_co);
    update orders set amount_paid = 20000, payment_status = 'part_paid' where id = v_co;
    insert into orders (account_id, business_id, order_no, order_date)
    values (a.acct, a.biz, 'T52-V', current_date) returning id into v_vo;
    insert into order_lines (account_id, order_id, recipe_id, qty, unit_price)
    values (a.acct, v_vo, v_dish, 1, 5000);
    perform fn_confirm_order(v_vo);
    perform fn_void_order(v_vo, 'typed twice');
    insert into sales_entries (account_id, business_id, sale_date, recipe_id, qty, unit_price)
    values (a.acct, a.biz, current_date, v_dish, 3, 5000) returning id into v_se;

    insert into fx_obj values (a.acct, a.biz, v_rice, v_dish, v_var, v_unit,
                               v_dp, v_pp, v_do, v_co, v_vo, v_se);
  end loop;

  -- people who matter after the trial: one invited, one already removed
  insert into invitations (account_id, email, role)
  select acct, 'u36@t52.test', 'sales' from fx_acct where k = 'E';
  insert into invitations (account_id, email, role)
  select acct, 'pending@t52.test', 'kitchen' from fx_acct where k = 'E';
  -- 33: older on E, newer on L. 38: older on L, newer on E.
  insert into memberships (account_id, user_id, role, created_at)
  select acct, pg_temp.u(33), 'sales'::member_role, now() - interval '10 days' from fx_acct where k = 'E'
  union all select acct, pg_temp.u(33), 'sales', now() from fx_acct where k = 'L'
  union all select acct, pg_temp.u(38), 'sales', now() - interval '10 days' from fx_acct where k = 'L'
  union all select acct, pg_temp.u(38), 'sales', now() from fx_acct where k = 'E';

  -- E's trial ended a minute ago; C pays for Costing
  update subscriptions set current_period_end = now() - interval '1 minute',
                           trial_ends_at      = now() - interval '1 minute'
   where account_id = (select acct from fx_acct where k = 'E');
  update subscriptions set plan_id = 'costing', status = 'active',
                           current_period_end = now() + interval '30 days'
   where account_id = (select acct from fx_acct where k = 'C');
end $$;

insert into t52 values (1, 'fixture: E has no access, L is a live trial, C pays for Costing without Sales',
  case when not fn_account_is_entitled((select acct from fx_acct where k='E'))
        and fn_account_is_entitled((select acct from fx_acct where k='L'))
        and fn_account_is_entitled((select acct from fx_acct where k='C'))
        and not fn_account_has_sales((select acct from fx_acct where k='C'))
        and fn_account_has_sales((select acct from fx_acct where k='L'))
       then 'PASS' else 'FAIL' end, '');

-- ============================================ 1. when a trial ends (D1)
do $$
declare v_ok boolean; v_s record;
begin
  v_ok := fn_trial_end('2026-10-18 09:30:00+01') = '2026-11-01 23:59:59+01'
      and fn_trial_end('2026-10-18 23:30:00+01') = '2026-11-01 23:59:59+01'
      and fn_trial_end('2026-10-18 00:00:00+01') = '2026-11-01 23:59:59+01'
      and fn_trial_end('2026-10-17 23:10:00+00') = '2026-11-01 23:59:59+01'   -- 00:10 on the 18th in Lagos
      and fn_trial_end('2026-10-17 22:59:59+00') = '2026-10-31 23:59:59+01'   -- 23:59:59 on the 17th
      and fn_trial_end(null) is null;
  insert into t52 values (2, 'fn_trial_end: 23:59:59 Lagos on the 14th Lagos day, wherever the start falls',
    case when v_ok then 'PASS' else 'FAIL' end, fn_trial_end('2026-10-18 09:30:00+01')::text);

  set local timezone = 'Pacific/Kiritimati';
  v_ok := fn_trial_end('2026-10-18 09:30:00+01') = '2026-11-01 22:59:59+00';
  set local timezone = 'America/Los_Angeles';
  v_ok := v_ok and fn_trial_end('2026-10-18 09:30:00+01') = '2026-11-01 22:59:59+00';
  set local timezone = 'UTC';
  insert into t52 values (3, 'and the session time zone does not change it (always 22:59:59 UTC)',
    case when v_ok then 'PASS' else 'FAIL' end, '');

  insert into t52 values (4, 'a trial started late in the day still gets at least 14 full days, never 15',
    case when fn_trial_end('2026-10-18 23:59:00+01') - '2026-10-18 23:59:00+01'::timestamptz >= interval '14 days'
          and fn_trial_end('2026-10-18 00:00:00+01') - '2026-10-18 00:00:00+01'::timestamptz <  interval '15 days'
         then 'PASS' else 'FAIL' end, '');

  select s.* into v_s from subscriptions s join fx_acct a on a.acct = s.account_id where a.k = 'L';
  insert into t52 values (5, 'onboarding ends a new trial at fn_trial_end(now()); both dates agree',
    case when v_s.current_period_end = fn_trial_end(now()) and v_s.trial_ends_at = v_s.current_period_end
          and to_char(v_s.current_period_end at time zone 'Africa/Lagos', 'HH24:MI:SS') = '23:59:59'
         then 'PASS' else 'FAIL' end, v_s.current_period_end::text);
end $$;

-- ============================================ 2. the 13 gated functions
create temp table fx_fn (n int, fn text, allowed text[], needs_sales boolean) on commit drop;
insert into fx_fn values
  ( 1, 'fn_post_purchase',                    array['owner','manager','accountant'], false),
  ( 2, 'fn_correct_purchase',                 array['owner','manager','accountant'], false),
  ( 3, 'fn_reverse_purchase',                 array['owner','manager','accountant'], false),
  ( 4, 'fn_recompute_business_recipes',       array['owner','manager','accountant'], false),
  ( 5, 'fn_recompute_recipes_for_ingredient', array['owner','manager','accountant'], false),
  ( 6, 'fn_compute_recipe_cost_snapshot',     array['owner','manager','accountant'], false),
  ( 7, 'fn_compute_variant_cost_snapshot',    array['owner','manager','accountant'], false),
  ( 8, 'fn_clone_starter_catalog',            array['owner'],                        false),
  ( 9, 'fn_confirm_order',                    array['owner','manager','sales'],      true),
  (10, 'fn_finalise_order',                   array['owner','manager','sales'],      true),
  (11, 'fn_reissue_order',                    array['owner','manager','sales'],      true),
  (12, 'fn_void_order',                       array['owner','manager'],              true),
  (13, 'fn_void_sales_entry',                 array['owner','manager'],              true);

create or replace function pg_temp.call_sql(p_fn text, p_acct uuid) returns text language plpgsql as $$
declare o record; kg uuid;
begin
  select * into o from fx_obj where acct = p_acct;
  select id into kg from units where account_id is null and code = 'kg';
  return case p_fn
    when 'fn_post_purchase' then format('select fn_post_purchase(%L)', o.draft_purchase)
    when 'fn_correct_purchase' then format(
      'select fn_correct_purchase(%L, current_date, null, %L, null, %L::jsonb)', o.posted_purchase, 'T52-FIX',
      jsonb_build_array(jsonb_build_object('ingredient_id', o.rice, 'qty', 50, 'unit_id', kg, 'amount', 87000))::text)
    when 'fn_reverse_purchase' then format('select fn_reverse_purchase(%L, %L)', o.posted_purchase, 'wrong supplier')
    when 'fn_recompute_business_recipes' then format('select fn_recompute_business_recipes(%L)', o.biz)
    when 'fn_recompute_recipes_for_ingredient' then format('select fn_recompute_recipes_for_ingredient(%L)', o.rice)
    when 'fn_compute_recipe_cost_snapshot' then format('select fn_compute_recipe_cost_snapshot(%L)', o.dish)
    when 'fn_compute_variant_cost_snapshot' then format('select fn_compute_variant_cost_snapshot(%L)', o.variant)
    when 'fn_clone_starter_catalog' then format('select fn_clone_starter_catalog(%L)', o.acct)
    when 'fn_confirm_order' then format('select fn_confirm_order(%L)', o.draft_order)
    when 'fn_finalise_order' then format('select fn_finalise_order(%L)', o.draft_order)
    when 'fn_reissue_order' then format('select fn_reissue_order(%L)', o.voided_order)
    when 'fn_void_order' then format('select fn_void_order(%L, %L)', o.confirmed_order, 'typo')
    when 'fn_void_sales_entry' then format('select fn_void_sales_entry(%L, %L)', o.sales_entry, 'typo')
  end;
end $$;

do $$
declare f record; a record; m record; v text; v_exp text; v_ok boolean; v_detail text; k int := 10;
begin
  for f in select * from fx_fn order by n loop
    for a in select * from fx_acct order by ord loop
      v_ok := true; v_detail := '';
      for m in select * from fx_member where acct = a.acct order by ord loop
        v := pg_temp.try_gate(m.uid, pg_temp.call_sql(f.fn, a.acct));
        v_exp := case when not (m.role = any(f.allowed)) then '42501'
                      when a.k = 'E' then 'MMENT@' || f.fn
                      when a.k = 'C' and f.needs_sales then 'MMSAL@' || f.fn
                      else 'ok' end;
        if v is distinct from v_exp then v_ok := false; end if;
        v_detail := v_detail || m.role || '='
                 || coalesce(case when v = v_exp then split_part(v, '@', 1) else v end, '?') || ' ';
      end loop;
      insert into t52 values (k,
        format('%s, %s account: %s', f.fn, a.label,
          case when a.k = 'E' then 'its own gate refuses with MMENT for ' || array_to_string(f.allowed, '/')
               when a.k = 'C' and f.needs_sales then 'its own gate refuses with MMSAL for ' || array_to_string(f.allowed, '/')
               else 'works for ' || array_to_string(f.allowed, '/') end
          || '; other roles 42501 as before'),
        case when v_ok then 'PASS' else 'FAIL' end, v_detail);
      k := k + 1;
    end loop;
  end loop;
end $$;
-- rows 10-48

do $$
declare f record; e uuid; v text; v_bad text := ''; v_str text := '';
begin
  select acct into e from fx_acct where k = 'E';
  for f in select * from fx_fn order by n loop
    v := pg_temp.try(null, pg_temp.call_sql(f.fn, e));
    if v <> 'ok' then v_bad := v_bad || f.fn || '=' || v || ' '; end if;
    v := pg_temp.try(pg_temp.u(31), pg_temp.call_sql(f.fn, e));
    if v <> '42501' then v_str := v_str || f.fn || '=' || v || ' '; end if;
  end loop;
  insert into t52 values (49, 'the operator (service context) can still run all 13 on the ended account',
    case when v_bad = '' then 'PASS' else 'FAIL' end, coalesce(nullif(v_bad, ''), 'all ok'));
  insert into t52 values (50, 'a stranger is refused all 13 with 42501, not told about the trial',
    case when v_str = '' then 'PASS' else 'FAIL' end, coalesce(nullif(v_str, ''), 'all 42501'));
end $$;

-- ============================================ 3. what people are told
do $$
declare e uuid; c uuid; v_o text; v_s text; v_k text; v_co text; v_cs text; v_pf text; v_se text; v_all text;
begin
  select acct into e from fx_acct where k = 'E';
  select acct into c from fx_acct where k = 'C';
  v_o  := pg_temp.try_msg(pg_temp.u(1),  pg_temp.call_sql('fn_post_purchase', e));
  v_s  := pg_temp.try_msg(pg_temp.u(4),  pg_temp.call_sql('fn_confirm_order', e));
  v_k  := pg_temp.try_msg(pg_temp.u(2),  pg_temp.call_sql('fn_void_order', e));
  v_co := pg_temp.try_msg(pg_temp.u(21), pg_temp.call_sql('fn_confirm_order', c));
  v_cs := pg_temp.try_msg(pg_temp.u(24), pg_temp.call_sql('fn_confirm_order', c));

  insert into t52 values (51, 'the owner of an ended trial is told it ended and to choose a plan',
    case when v_o like 'MMENT|trial_ended|Your free trial has ended, so nothing new can be saved.%'
          and v_o like '%Choose a plan on Plans & billing%' and v_o like '%Everything already entered is still here.'
         then 'PASS' else 'FAIL' end, v_o);
  insert into t52 values (52, 'staff are told to ask the owner, and that payments on confirmed sales still work',
    case when v_s like 'MMENT|trial_ended|The free trial for this business has ended%Ask the owner to choose a plan.%'
          and v_s like '%Payments on sales already confirmed can still be recorded.%'
          and v_k like 'MMENT|trial_ended|%Ask the owner%'
         then 'PASS' else 'FAIL' end, v_s);
  insert into t52 values (53, 'on Costing the owner is told the plan covers costing only (MMSAL)',
    case when v_co like 'MMSAL|no_sales|Your plan covers costing only, so sales cannot be recorded or changed.%Costing + Sales%'
          and v_cs like 'MMSAL|no_sales|%Ask the owner about Costing + Sales.%'
         then 'PASS' else 'FAIL' end, v_co);

  -- a failed payment past its grace, then a plan that ran out
  perform pg_temp.as_user(null);
  update subscriptions set plan_id = 'trading', status = 'past_due', current_period_end = now() - interval '60 days'
   where account_id = e;
  v_pf := pg_temp.try_msg(pg_temp.u(1), pg_temp.call_sql('fn_post_purchase', e));
  update subscriptions set status = 'cancelled', current_period_end = now() - interval '1 day'
   where account_id = e;
  v_se := pg_temp.try_msg(pg_temp.u(1), pg_temp.call_sql('fn_post_purchase', e));
  update subscriptions set plan_id = 'trial', status = 'trialing', current_period_end = now() - interval '1 minute'
   where account_id = e;
  insert into t52 values (54, 'a failed payment and an ended plan each get their own words',
    case when v_pf like 'MMENT|payment_failed|Your last payment did not go through%Update your card%'
          and v_se like 'MMENT|subscription_ended|Your plan has ended%'
         then 'PASS' else 'FAIL' end, v_pf || ' / ' || v_se);

  v_all := v_o || v_s || v_k || v_co || v_cs || v_pf || v_se;
  insert into t52 values (55, 'no refusal names an amount of money',
    case when v_all !~ (chr(8358) || '|[0-9]') then 'PASS' else 'FAIL' end, '');  -- 8358: the naira sign
end $$;

-- ============================================ 4. member management stays open
do $$
declare e uuid; v_inv text; v_rev text; v_role text; v_rm text; v_acc jsonb; v_pending uuid;
begin
  select acct into e from fx_acct where k = 'E';
  select id into v_pending from invitations where account_id = e and email = 'pending@t52.test';
  v_inv  := pg_temp.try(pg_temp.u(1), format('select fn_invite_member(%L, %L, %L)', e, 'late-cook@t52.test', 'kitchen'));
  v_rev  := pg_temp.try(pg_temp.u(1), format('select fn_revoke_invitation(%L)', v_pending));
  v_role := pg_temp.try(pg_temp.u(1), format('select fn_set_member_role(%L, %L, %L)', e, pg_temp.u(3), 'sales'));
  v_rm   := pg_temp.try(pg_temp.u(1), format('select fn_remove_member(%L, %L)', e, pg_temp.u(5)));

  perform pg_temp.as_user(pg_temp.u(36));
  set local role authenticated;
  v_acc := fn_accept_invitations();
  reset role;
  perform pg_temp.as_user(null);

  insert into t52 values (56, 'after the trial the owner can still invite, revoke, change a role and remove',
    case when v_inv = 'ok' and v_rev = 'ok' and v_role = 'ok' and v_rm = 'ok' then 'PASS' else 'FAIL' end,
    v_inv || ' ' || v_rev || ' ' || v_role || ' ' || v_rm);
  insert into t52 values (57, 'and an invited person can still accept and join',
    case when (v_acc->>'accepted')::int = 1
          and exists (select 1 from memberships where account_id = e and user_id = pg_temp.u(36))
         then 'PASS' else 'FAIL' end, v_acc::text);
end $$;

-- ============================================ 5. money received on a confirmed sale (D2)
do $$
declare
  e uuid; c uuid; l uuid; o record; oc record; ol record;
  b jsonb; a jsonb; v_out_before numeric; v_out_after numeric;
  v_own text; v_man text; v_sal text; v_kit text; v_acc text; v_str text;
  v_draft text; v_void text; v_neg text; v_null text; v_c text; v_l text; v_svc text; v_cpay record;
  v_nullamt text; v_big text; v_gone text; v_role text;
begin
  select acct into e from fx_acct where k = 'E';
  select acct into c from fx_acct where k = 'C';
  select acct into l from fx_acct where k = 'L';
  select * into o  from fx_obj where acct = e;
  select * into oc from fx_obj where acct = c;
  select * into ol from fx_obj where acct = l;

  b := to_jsonb(orders) - 'amount_paid' - 'payment_status' from orders where id = o.confirmed_order;
  select amount_outstanding into v_out_before from v_orders_attention where order_id = o.confirmed_order;

  -- the owner, then the manager, then the sales helper, for real
  perform pg_temp.as_user(pg_temp.u(1)); set local role authenticated;
  v_own := 'ok'; begin perform fn_record_order_payment(o.confirmed_order, 25000, 'part_paid');
  exception when others then v_own := sqlstate; end;
  reset role;
  perform pg_temp.as_user(pg_temp.u(2)); set local role authenticated;
  v_man := 'ok'; begin perform fn_record_order_payment(o.confirmed_order, 40000, 'part_paid');
  exception when others then v_man := sqlstate; end;
  reset role;
  perform pg_temp.as_user(pg_temp.u(4)); set local role authenticated;
  v_sal := 'ok'; begin perform fn_record_order_payment(o.confirmed_order, 50000, 'paid');
  exception when others then v_sal := sqlstate; end;
  reset role;
  perform pg_temp.as_user(null);

  a := to_jsonb(orders) - 'amount_paid' - 'payment_status' from orders where id = o.confirmed_order;
  select amount_outstanding into v_out_after from v_orders_attention where order_id = o.confirmed_order;

  insert into t52 values (58, 'after the trial owner, manager and sales record money on a confirmed sale',
    case when v_own = 'ok' and v_man = 'ok' and v_sal = 'ok' then 'PASS' else 'FAIL' end,
    v_own || ' ' || v_man || ' ' || v_sal);
  insert into t52 values (59, 'the sale now reads paid in full and nothing is left to pay',
    case when (select amount_paid = 50000 and payment_status = 'paid' from orders where id = o.confirmed_order)
          and v_out_before = 30000 and v_out_after = 0 then 'PASS' else 'FAIL' end,
    coalesce(v_out_before::text, 'NULL') || ' -> ' || coalesce(v_out_after::text, 'NULL'));
  insert into t52 values (60, 'and no other column of the sale moved',
    case when a = b then 'PASS' else 'FAIL' end, '');

  v_kit  := pg_temp.try(pg_temp.u(3),  format('select fn_record_order_payment(%L, 1, %L)', o.confirmed_order, 'paid'));
  v_acc  := pg_temp.try(pg_temp.u(5),  format('select fn_record_order_payment(%L, 1, %L)', o.confirmed_order, 'paid'));
  v_str  := pg_temp.try(pg_temp.u(31), format('select fn_record_order_payment(%L, 1, %L)', o.confirmed_order, 'paid'));
  insert into t52 values (61, 'kitchen, the accountant and a stranger are refused (42501)',
    case when v_kit = '42501' and v_acc = '42501' and v_str = '42501' then 'PASS' else 'FAIL' end,
    v_kit || ' ' || v_acc || ' ' || v_str);

  -- its own refusals (X5): SQLSTATE MMPAY, no hint, a sentence shown as it is
  v_draft   := pg_temp.try_msg(pg_temp.u(1), format('select fn_record_order_payment(%L, 1000, %L)', o.draft_order, 'part_paid'));
  v_void    := pg_temp.try_msg(pg_temp.u(4), format('select fn_record_order_payment(%L, 1000, %L)', o.voided_order, 'part_paid'));
  v_neg     := pg_temp.try_msg(pg_temp.u(1), format('select fn_record_order_payment(%L, -1, %L)', o.confirmed_order, 'part_paid'));
  v_nullamt := pg_temp.try_msg(pg_temp.u(2), format('select fn_record_order_payment(%L, null, %L)', o.confirmed_order, 'paid'));
  v_null    := pg_temp.try_msg(pg_temp.u(1), format('select fn_record_order_payment(%L, 1000, null)', o.confirmed_order));
  v_big     := pg_temp.try_msg(pg_temp.u(1), format('select fn_record_order_payment(%L, 999999999999.995, %L)', o.confirmed_order, 'paid'));
  v_gone    := pg_temp.try_msg(pg_temp.u(1), format('select fn_record_order_payment(%L, 1000, %L)', gen_random_uuid(), 'paid'));
  v_role    := pg_temp.try_msg(pg_temp.u(3), format('select fn_record_order_payment(%L, 1, %L)', o.confirmed_order, 'paid'));
  insert into t52 values (62, 'a draft, a cancelled sale, a negative or missing amount and no status are refused with MMPAY',
    case when split_part(v_draft, '|', 1) = 'MMPAY' and split_part(v_void, '|', 1) = 'MMPAY'
          and split_part(v_neg, '|', 1) = 'MMPAY' and split_part(v_nullamt, '|', 1) = 'MMPAY'
          and split_part(v_null, '|', 1) = 'MMPAY'
          and (select amount_paid = 0 from orders where id = o.draft_order)
         then 'PASS' else 'FAIL' end,
    split_part(v_draft, '|', 1) || ' ' || split_part(v_void, '|', 1) || ' ' || split_part(v_neg, '|', 1) || ' '
      || split_part(v_nullamt, '|', 1) || ' ' || split_part(v_null, '|', 1));
  insert into t52 values (84, 'MMPAY messages: draft, cancelled, amount and status, each a plain sentence as written',
    case when v_draft   = 'MMPAY||This sale is still a draft. A payment can be recorded once it is confirmed.'
          and v_void    = 'MMPAY||This sale was cancelled, so no payment can be recorded on it.'
          and v_neg     = 'MMPAY||The amount paid must be zero or more.'
          and v_nullamt = 'MMPAY||The amount paid must be zero or more.'
          and v_null    = 'MMPAY||Say whether the sale is not paid, part paid or paid in full.'
         then 'PASS' else 'FAIL' end, v_draft);
  insert into t52 values (85, 'a sale that does not exist, and an amount too large to store, are MMPAY too',
    case when v_gone = 'MMPAY||This sale could not be found. It may have been removed.'
          and v_big  = 'MMPAY||That amount is too large to record. Check the figure and try again.'
          and (select amount_paid = 50000 from orders where id = o.confirmed_order)
         then 'PASS' else 'FAIL' end, v_gone || ' / ' || v_big);
  insert into t52 values (86, 'the role refusal stays 42501 from fn_require_account_role (the app words it)',
    case when v_role = '42501||Your role does not permit recording payments' then 'PASS' else 'FAIL' end, v_role);
  insert into t52 values (87, 'no payment refusal names an amount of money or a database word',
    case when (v_draft || v_void || v_neg || v_nullamt || v_null || v_big || v_gone)
              !~* (chr(8358) || '|[0-9]|sqlstate|exception|violat|constraint|null|uuid')
         then 'PASS' else 'FAIL' end, '');

  -- the Costing account settles a sale it confirmed during its trial; L and the operator too
  perform pg_temp.as_user(pg_temp.u(24)); set local role authenticated;
  v_c := 'ok'; begin perform fn_record_order_payment(oc.confirmed_order, 50000, 'paid');
  exception when others then v_c := sqlstate; end;
  reset role;
  perform pg_temp.as_user(null);
  select amount_paid, payment_status into v_cpay from orders where id = oc.confirmed_order;
  v_l   := pg_temp.try(pg_temp.u(14), format('select fn_record_order_payment(%L, 50000, %L)', ol.confirmed_order, 'paid'));
  v_svc := pg_temp.try(null,           format('select fn_record_order_payment(%L, 50000, %L)', o.confirmed_order, 'paid'));
  insert into t52 values (63, 'on Costing the sales helper records the balance of a sale confirmed during the trial',
    case when v_c = 'ok' and v_cpay.amount_paid = 50000 and v_cpay.payment_status = 'paid' then 'PASS' else 'FAIL' end, v_c);
  insert into t52 values (64, 'and it works on a live trial and for the operator',
    case when v_l = 'ok' and v_svc = 'ok' then 'PASS' else 'FAIL' end, v_l || ' ' || v_svc);
  insert into t52 values (65, 'a draft still cannot be changed directly on the ended account (row policy, unchanged)',
    case when pg_temp.try(pg_temp.u(1), format(
           'with u as (update orders set amount_paid = 5 where id = %L returning 1) select 1/(select count(*) from u)',
           o.draft_order)) = '22012' then 'PASS' else 'FAIL' end, '');
end $$;

-- ============================================ 6. onboarding (D1, D4)
do $$
declare
  v1 text; v2 text; v3 text; r jsonb; r2 jsonb; s record; n_acc int; n_sub int;
  v_es text; v_ls text; v_leave jsonb; v_eo text; n_biz int; v_lo jsonb; v_14 jsonb; v_svc jsonb; v_svc2 jsonb;
  e uuid; l uuid;
begin
  select acct into e from fx_acct where k = 'E';
  select acct into l from fx_acct where k = 'L';

  v1 := pg_temp.try(pg_temp.u(32), 'select fn_create_account_and_business(''N'',''N'',''other'', p_trial_days => 3650, p_idempotency_key => ''t52-n1'')');
  v2 := pg_temp.try(pg_temp.u(32), 'select fn_create_account_and_business(''N'',''N'',''other'', p_trial_days => 0, p_idempotency_key => ''t52-n2'')');
  v3 := pg_temp.try(pg_temp.u(32), 'select fn_create_account_and_business(''N'',''N'',''other'', p_trial_days => null, p_idempotency_key => ''t52-n3'')');
  insert into t52 values (66, 'a signed-in caller cannot choose the trial length (3650, 0, NULL: 22023)',
    case when v1 = '22023' and v2 = '22023' and v3 = '22023' then 'PASS' else 'FAIL' end, v1 || ' ' || v2 || ' ' || v3);

  perform pg_temp.as_user(pg_temp.u(32)); set local role authenticated;
  r  := fn_create_account_and_business('T52 New', 'T52 New Kitchen', 'caterer', p_idempotency_key => 't52-new');
  r2 := fn_create_account_and_business('T52 New', 'T52 New Kitchen', 'caterer', p_idempotency_key => 't52-new');
  reset role;
  perform pg_temp.as_user(pg_temp.u(35)); set local role authenticated;
  v_14 := fn_create_account_and_business('T52 Other', 'T52 Other', 'other', p_trial_days => 14, p_idempotency_key => 't52-14');
  reset role;
  perform pg_temp.as_user(null);
  select * into s from subscriptions where account_id = (r->>'account_id')::uuid;
  insert into t52 values (67, 'a newcomer gets a trial ending at fn_trial_end(now()), both dates equal',
    case when s.status = 'trialing' and s.plan_id = 'trial'
          and s.current_period_end = fn_trial_end(now()) and s.trial_ends_at = s.current_period_end
         then 'PASS' else 'FAIL' end, s.current_period_end::text);
  insert into t52 values (68, 'the starter catalogue is still loaded at first onboarding (now gated)',
    case when (r->>'ingredients_added')::int > 0
          and (select count(*) from ingredients where account_id = (r->>'account_id')::uuid) = (r->>'ingredients_added')::int
         then 'PASS' else 'FAIL' end, r->>'ingredients_added');
  insert into t52 values (69, 'a retried onboarding replays the stored answer; asking for 14 days is fine',
    case when (r2->>'idempotent_replay')::boolean and r2->>'account_id' = r->>'account_id'
          and (v_14->>'account_created')::boolean then 'PASS' else 'FAIL' end, r2->>'idempotent_replay');

  select count(*) into n_acc from accounts;
  select count(*) into n_sub from subscriptions;
  v_es := pg_temp.try_msg(pg_temp.u(4),  'select fn_create_account_and_business(''Mine'',''Mine'',''other'', p_idempotency_key => ''t52-es'')');
  v_ls := pg_temp.try(pg_temp.u(14), 'select fn_create_account_and_business(''Mine'',''Mine'',''other'', p_idempotency_key => ''t52-ls'')');
  insert into t52 values (70, 'staff of an ended account cannot start their own (MMLGN, plain words)',
    case when v_es like 'MMLGN||This login already belongs to a business on Menu Master. To run a business of your own, sign up with a different email address.'
         then 'PASS' else 'FAIL' end, v_es);
  insert into t52 values (71, 'nor can staff of a live account; no account or trial was created',
    case when v_ls = 'MMLGN' and n_acc = (select count(*) from accounts) and n_sub = (select count(*) from subscriptions)
         then 'PASS' else 'FAIL' end, v_ls);

  -- 34 was sales on E and was removed; with no membership left, they may start
  insert into memberships (account_id, user_id, role) values (e, pg_temp.u(34), 'sales');
  delete from memberships where account_id = e and user_id = pg_temp.u(34);
  perform pg_temp.as_user(pg_temp.u(34)); set local role authenticated;
  v_leave := fn_create_account_and_business('T52 Leaver', 'T52 Leaver', 'other', p_idempotency_key => 't52-leave');
  reset role;
  perform pg_temp.as_user(null);
  insert into t52 values (72, 'a removed member with no account left can start their own',
    case when (v_leave->>'account_created')::boolean then 'PASS' else 'FAIL' end, v_leave::text);

  select count(*) into n_biz from businesses where account_id = e;
  v_eo := pg_temp.try(pg_temp.u(1), 'select fn_create_account_and_business(''T52 Ended'',''Second Shop'',''other'', p_idempotency_key => ''t52-eo'')');
  insert into t52 values (73, 'the owner of an ended account cannot add a business (MMENT)',
    case when v_eo = 'MMENT' and n_biz = (select count(*) from businesses where account_id = e)
         then 'PASS' else 'FAIL' end, v_eo);

  perform pg_temp.as_user(pg_temp.u(11)); set local role authenticated;
  v_lo := fn_create_account_and_business('T52 Live', 'T52 Second Shop', 'other', p_idempotency_key => 't52-lo');
  reset role;
  perform pg_temp.as_user(null);
  insert into t52 values (74, 'the owner of a live account adds one: same account, no second trial, no second catalogue',
    case when (v_lo->>'account_id')::uuid = l and not (v_lo->>'account_created')::boolean
          and (v_lo->>'ingredients_added')::int = 0
          and (select count(*) from subscriptions where account_id = l) = 1 then 'PASS' else 'FAIL' end, v_lo::text);

  -- the operator keeps the parameter and may provision any login
  v_svc  := fn_create_account_and_business('T52 Ops', 'T52 Ops', 'other', pg_temp.u(37),
                                           p_trial_days => 30, p_idempotency_key => 't52-ops');
  v_svc2 := fn_create_account_and_business('T52 Ops 2', 'T52 Ops 2', 'other', pg_temp.u(4),
                                           p_idempotency_key => 't52-ops2');
  insert into t52 values (75, 'the operator (service context) may still set the length and provision a staff login',
    case when (select current_period_end = now() + interval '30 days' from subscriptions
                where account_id = (v_svc->>'account_id')::uuid)
          and (v_svc2->>'account_created')::boolean then 'PASS' else 'FAIL' end, '');
end $$;

-- ============================================ 7. the subscription guard (D1)
create function public.t52_make_trial(p_acct uuid, p_end timestamptz, p_trial timestamptz) returns void
language sql security definer set search_path = public as
$$ insert into subscriptions (account_id, plan_id, status, trial_ends_at, current_period_end)
   values (p_acct, 'trial', 'trialing', p_trial, p_end) $$;
grant execute on function public.t52_make_trial(uuid, timestamptz, timestamptz) to authenticated;
create temp table fx_bare on commit drop as select gen_random_uuid() as acct;
insert into accounts (id, name) select acct, 'T52 Bare' from fx_bare;

do $$
declare b uuid; v15 text; vnull text; vok text;
begin
  select acct into b from fx_bare;
  v15   := pg_temp.try(pg_temp.u(31), format('select t52_make_trial(%L, now() + interval ''15 days'', now() + interval ''15 days'')', b));
  vnull := pg_temp.try(pg_temp.u(31), format('select t52_make_trial(%L, fn_trial_end(now()), null)', b));
  vok   := pg_temp.try(pg_temp.u(31), format('select t52_make_trial(%L, fn_trial_end(now()), fn_trial_end(now()))', b));
  insert into t52 values (76, 'a trial made outside billing must end at fn_trial_end(now()) with both dates equal',
    case when v15 = '42501' and vnull = '42501' and vok = 'ok' then 'PASS' else 'FAIL' end,
    v15 || ' ' || vnull || ' ' || vok);
end $$;

-- ============================================ 8. one account per login, the oldest (DB4)
do $$
declare v record; v_same boolean := true; v_first text; v_has boolean; w record; w_has boolean;
begin
  perform pg_temp.as_user(pg_temp.u(33)); set local role authenticated;
  select entitled, reason into v from fn_my_entitlement_status();
  v_first := v.reason;
  for i in 1 .. 5 loop
    if (select reason from fn_my_entitlement_status()) is distinct from v_first then v_same := false; end if;
  end loop;
  v_has := fn_my_has_sales();
  reset role;
  perform pg_temp.as_user(pg_temp.u(38)); set local role authenticated;
  select entitled, reason into w from fn_my_entitlement_status();
  w_has := fn_my_has_sales();
  reset role;
  perform pg_temp.as_user(null);
  insert into t52 values (77, 'a login on two accounts sees its OLDEST one, every time, agreeing with fn_my_has_sales',
    case when not v.entitled and v.reason = 'trial_ended' and v_same and not v_has
          and w.entitled and w.reason = 'trial_active' and w_has then 'PASS' else 'FAIL' end,
    v.reason || ' / ' || w.reason);
end $$;

-- ============================================ 9. custom units (D7)
do $$
declare
  a record; m record; v_ins text; v_upd text; v_del text; v_ok boolean; v_detail text; v_read text;
  e uuid; v_eo_ins text; v_eo_upd text; v_ek_ins text;
begin
  for a in select * from fx_acct where k = 'L' loop
    v_ok := true; v_detail := '';
    for m in select * from fx_member where acct = a.acct order by ord loop
      v_ins := pg_temp.try(m.uid, format('insert into units (account_id, code, name, kind) values (%L, %L, %L, %L)',
                                          a.acct, 't52tin', 'Tin', 'container'));
      v_upd := pg_temp.try(m.uid, format(
        'with u as (update units set factor_to_base = 2 where id = %L returning 1) select 1/(select count(*) from u)',
        (select unit from fx_obj where acct = a.acct)));
      v_del := pg_temp.try(m.uid, format(
        'with u as (delete from units where id = %L returning 1) select 1/(select count(*) from u)',
        (select unit from fx_obj where acct = a.acct)));
      if m.role in ('owner','manager','kitchen') then
        v_ok := v_ok and v_ins = 'ok' and v_upd = 'ok' and v_del = 'ok';
      else
        v_ok := v_ok and v_ins = '42501' and v_upd = '22012' and v_del = '22012';
      end if;
      v_detail := v_detail || m.role || '=' || v_ins || '/' || v_upd || '/' || v_del || ' ';
    end loop;
    insert into t52 values (78, 'live account: owner, manager and kitchen add, change and remove units; sales and accountant cannot',
      case when v_ok then 'PASS' else 'FAIL' end, v_detail);
  end loop;

  select acct into e from fx_acct where k = 'E';
  v_eo_ins := pg_temp.try(pg_temp.u(1), format('insert into units (account_id, code, name, kind) values (%L, %L, %L, %L)',
                                                e, 't52tin', 'Tin', 'container'));
  v_eo_upd := pg_temp.try(pg_temp.u(1), format(
    'with u as (update units set factor_to_base = 2 where id = %L returning 1) select 1/(select count(*) from u)',
    (select unit from fx_obj where acct = e)));
  v_ek_ins := pg_temp.try(pg_temp.u(3), format('insert into units (account_id, code, name, kind) values (%L, %L, %L, %L)',
                                                e, 't52tin', 'Tin', 'container'));
  v_read := pg_temp.try(pg_temp.u(4), format('select 1/(select count(*) from units where account_id = %L)', e));
  insert into t52 values (79, 'ended account: nobody adds or changes a unit',
    case when v_eo_ins = '42501' and v_eo_upd = '22012' and v_ek_ins = '42501' then 'PASS' else 'FAIL' end,
    v_eo_ins || ' ' || v_eo_upd || ' ' || v_ek_ins);
  insert into t52 values (80, 'but every member still reads its custom units (reads are never gated)',
    case when v_read = 'ok' then 'PASS' else 'FAIL' end, v_read);
end $$;

-- ============================================ 10. the catalogue rule and the grants
insert into t52
select 81, 'every elevated volatile fn_* a signed-in user can run asks fn_require_entitled or is on the open list',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname like 'fn\_%'
   and p.prosecdef and p.provolatile = 'v'
   and p.prorettype <> 'trigger'::regtype
   and has_function_privilege('authenticated', p.oid, 'execute')
   and p.prosrc !~ 'perform\s+fn_require_entitled\('
   and p.proname not in ('fn_invite_member','fn_accept_invitations','fn_set_member_role',
                         'fn_remove_member','fn_revoke_invitation',
                         'fn_record_order_payment',
                         'fn_admin_resolve_alert','fn_admin_set_site_setting','fn_admin_scan',
                         'fn_create_account_and_business',
                         -- 0068: a person's own contact choice is not business
                         -- data, and withdrawing it must stay as easy as giving
                         -- it after a trial too (NDPA s.35); the admin's
                         -- check-ins are not the customer's work.
                         'fn_set_my_contact','fn_admin_record_checkin',
                         -- 0069: recording which screen is open, asking for
                         -- help and answering a rating must keep working after
                         -- a trial -- that is exactly when people get stuck.
                         'fn_usage_beat','fn_usage_event','fn_ask_for_help','fn_give_feedback',
                         'fn_set_my_usage_tracking','fn_admin_set_help_status');

insert into t52
select 82, 'the 13 gated functions and onboarding ask it; member management and payments do not',
       case when count(*) = 20 and count(*) filter (where gated <> expect) = 0 then 'PASS' else 'FAIL' end,
       coalesce(string_agg(proname || '=' || gated, ' ' order by proname) filter (where gated <> expect),
                count(*) || ' functions as expected')
  from (select p.proname, p.prosrc ~ 'perform\s+fn_require_entitled\(' as gated,
               p.proname not in ('fn_invite_member','fn_accept_invitations','fn_set_member_role',
                                 'fn_remove_member','fn_revoke_invitation','fn_record_order_payment') as expect
          from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and p.proname in ('fn_post_purchase','fn_correct_purchase','fn_reverse_purchase',
                             'fn_recompute_business_recipes','fn_recompute_recipes_for_ingredient',
                             'fn_compute_recipe_cost_snapshot','fn_compute_variant_cost_snapshot',
                             'fn_clone_starter_catalog','fn_confirm_order','fn_finalise_order',
                             'fn_reissue_order','fn_void_order','fn_void_sales_entry',
                             'fn_create_account_and_business',
                             'fn_invite_member','fn_accept_invitations','fn_set_member_role',
                             'fn_remove_member','fn_revoke_invitation','fn_record_order_payment')) x;

do $$
declare v_direct text; v_anon text;
begin
  v_direct := pg_temp.try(pg_temp.u(1), format('select fn_require_entitled(%L)', (select acct from fx_acct where k = 'L')));
  insert into t52 values (83, 'nobody calls the gate directly; a logged-out caller cannot record payments',
    case when v_direct = '42501'
          and not has_function_privilege('anon', 'fn_require_entitled(uuid,boolean)', 'execute')
          and not has_function_privilege('anon', 'fn_record_order_payment(uuid,numeric,payment_status)', 'execute')
          and has_function_privilege('authenticated', 'fn_record_order_payment(uuid,numeric,payment_status)', 'execute')
         then 'PASS' else 'FAIL' end, v_direct);
end $$;

select n, check_name, verdict, left(detail, 80) as detail from t52 order by n;
select count(*) filter (where verdict = 'PASS') as pass,
       count(*) filter (where verdict <> 'PASS') as fail from t52;

rollback;
