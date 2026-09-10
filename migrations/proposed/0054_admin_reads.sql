-- ============================================================================
-- MENU MASTER NG
-- 0054: what a platform administrator may read, and nothing else
--
-- Requires: 0001-0053 applied.
--
-- Three SECURITY DEFINER reads, each opening with fn_require_platform_admin()
-- BEFORE it touches a table, each returning one jsonb document so the page
-- renders what the database decided and computes nothing of its own.
--
-- WHAT THEY RETURN
--   fn_admin_billing_health(days)  event counts by day and status, the open
--                                  reconciliation rows, the anomaly rows,
--                                  signature rejections
--   fn_admin_subscriptions()       one row per subscription with its plan,
--                                  status, dates, price, founder slot and the
--                                  database's own entitlement verdict; the
--                                  founder-slot totals
--   fn_admin_signups(days)         accounts created per day, accounts with no
--                                  business yet, trials ending within 7 days
--
-- WHAT THEY NEVER RETURN
--   No customer data: no recipe, ingredient, price, purchase or sale.
--   No billing_events.payload -- the redacted shape is not returned either;
--   only the columns v_billing_reconciliation already exposes.
--   No provider customer or subscription codes.
--   The owner's email address IS returned beside each account, because a
--   support conversation starts from it; it is the same address the owner
--   already sees on their own account page.
-- ============================================================================

drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0054 ABORT: this executor is not honouring transaction control '
      '(each statement is committing on its own). Run it with '
      'psql --single-transaction over the Session Pooler.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from pg_proc where proname='fn_require_platform_admin'
                   and pronamespace='public'::regnamespace) then
    raise exception '0054 preflight FAILED: fn_require_platform_admin is missing. Apply 0053 first.';
  end if;
  if exists (select 1 from pg_proc where proname='fn_admin_subscriptions'
               and pronamespace='public'::regnamespace) then
    raise exception '0054 preflight FAILED: fn_admin_subscriptions already exists.';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 117 then
    raise exception '0054 preflight FAILED: policy count is %, expected 117.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 79 then
    raise exception '0054 preflight FAILED: fn_* count is %, expected 79.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Billing health
-- ---------------------------------------------------------------------------
create or replace function fn_admin_billing_health(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare v_since timestamptz; v jsonb;
begin
  perform fn_require_platform_admin();
  v_since := date_trunc('day', now()) - make_interval(days => greatest(coalesce(p_days, 30), 1) - 1);

  select jsonb_build_object(
    'days', greatest(coalesce(p_days, 30), 1),
    'since', v_since,
    'events_by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d, 'status', s, 'n', n) order by d, s)
        from (select received_at::date as d, status as s, count(*) as n
                from billing_events where received_at >= v_since
               group by 1, 2) x), '[]'::jsonb),
    'totals', coalesce((
      select jsonb_object_agg(status, n)
        from (select status, count(*) as n from billing_events
               where received_at >= v_since group by status) x), '{}'::jsonb),
    'signature_rejections', (
      select count(*) from billing_events
       where received_at >= v_since and signature_valid = false),
    'reconciliation', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.received_at desc)
        from v_billing_reconciliation r), '[]'::jsonb),
    'anomalies', coalesce((
      select jsonb_agg(to_jsonb(a)) from v_billing_anomalies a), '[]'::jsonb)
  ) into v;
  return v;
end;
$fn$;

revoke all on function fn_admin_billing_health(integer) from public, anon;
grant execute on function fn_admin_billing_health(integer) to authenticated, service_role;

comment on function fn_admin_billing_health(integer) is
  'Platform administrators only (fn_require_platform_admin raises 42501 first). '
  'Billing event counts, the open reconciliation rows and the anomaly rows. '
  'Never returns a payload.';

-- ---------------------------------------------------------------------------
-- 2. Subscriptions
--
-- entitled is fn_account_is_entitled -- the same predicate the 69 gated write
-- policies use -- so the admin page shows the database's verdict, not a
-- second reading of the dates.
-- ---------------------------------------------------------------------------
create or replace function fn_admin_subscriptions()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare v jsonb;
begin
  perform fn_require_platform_admin();

  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'account_id',            s.account_id,
               'account_name',          a.name,
               'owner_email',           (select u.email from memberships m join auth.users u on u.id = m.user_id
                                          where m.account_id = s.account_id and m.role = 'owner'
                                          order by m.created_at limit 1),
               'plan_id',               s.plan_id,
               'plan_name',             p.name,
               'tier',                  p.tier,
               'price_tier',            p.price_tier,
               'status',                s.status,
               'trial_ends_at',         s.trial_ends_at,
               'current_period_end',    s.current_period_end,
               'price_kobo',            s.price_kobo,
               'founding_price_active', s.founding_price_active,
               'cancel_at_period_end',  s.cancel_at_period_end,
               'founder_seq',           (select f.seq from founder_slots f where f.account_id = s.account_id),
               'created_at',            s.created_at,
               'entitled',              fn_account_is_entitled(s.account_id)
             ) order by s.created_at desc)
        from subscriptions s
        join accounts a on a.id = s.account_id
        join plans p on p.id = s.plan_id), '[]'::jsonb),
    'by_status', coalesce((
      select jsonb_object_agg(status, n)
        from (select status, count(*) as n from subscriptions group by status) x), '{}'::jsonb),
    'founder_slots', (
      select jsonb_build_object(
        'total',     count(*),
        'claimed',   count(*) filter (where claimed_at is not null and forfeited_at is null),
        'forfeited', count(*) filter (where forfeited_at is not null),
        'reserved',  count(*) filter (where claimed_at is null and reserved_until is not null and reserved_until > now()),
        'free',      count(*) filter (where account_id is null))
        from founder_slots)
  ) into v;
  return v;
end;
$fn$;

revoke all on function fn_admin_subscriptions() from public, anon;
grant execute on function fn_admin_subscriptions() to authenticated, service_role;

comment on function fn_admin_subscriptions() is
  'Platform administrators only. Every subscription with its plan, dates, '
  'price, founder slot and the database''s own entitlement verdict; founder '
  'slot totals. No provider codes.';

-- ---------------------------------------------------------------------------
-- 3. Signups
-- ---------------------------------------------------------------------------
create or replace function fn_admin_signups(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare v_since timestamptz; v jsonb;
begin
  perform fn_require_platform_admin();
  v_since := date_trunc('day', now()) - make_interval(days => greatest(coalesce(p_days, 30), 1) - 1);

  select jsonb_build_object(
    'days', greatest(coalesce(p_days, 30), 1),
    'since', v_since,
    'total_accounts', (select count(*) from accounts where deleted_at is null),
    'per_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d, 'accounts', n) order by d)
        from (select created_at::date as d, count(*) as n
                from accounts where created_at >= v_since group by 1) x), '[]'::jsonb),
    'accounts_without_business', coalesce((
      select jsonb_agg(jsonb_build_object(
               'account_id', a.id, 'name', a.name, 'created_at', a.created_at,
               'owner_email', (select u.email from memberships m join auth.users u on u.id = m.user_id
                                where m.account_id = a.id and m.role = 'owner'
                                order by m.created_at limit 1)) order by a.created_at desc)
        from accounts a
       where a.deleted_at is null
         and not exists (select 1 from businesses b where b.account_id = a.id and b.deleted_at is null)), '[]'::jsonb),
    'trials_ending_soon', coalesce((
      select jsonb_agg(jsonb_build_object(
               'account_id', s.account_id, 'name', a.name, 'trial_ends_at', s.trial_ends_at,
               'owner_email', (select u.email from memberships m join auth.users u on u.id = m.user_id
                                where m.account_id = s.account_id and m.role = 'owner'
                                order by m.created_at limit 1)) order by s.trial_ends_at)
        from subscriptions s join accounts a on a.id = s.account_id
       where s.status = 'trialing'
         and s.trial_ends_at between now() and now() + interval '7 days'), '[]'::jsonb),
    'users_without_account', (
      select count(*) from auth.users u
       where not exists (select 1 from memberships m where m.user_id = u.id))
  ) into v;
  return v;
end;
$fn$;

revoke all on function fn_admin_signups(integer) from public, anon;
grant execute on function fn_admin_signups(integer) to authenticated, service_role;

comment on function fn_admin_signups(integer) is
  'Platform administrators only. Accounts per day, accounts that never made a '
  'business, trials ending within a week, and how many logins have no account.';

-- ---------------------------------------------------------------------------
-- 4. Self-check
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  if (select count(*) from pg_policies where schemaname='public') <> 117 then
    raise exception '0054 self-check FAILED: 0054 must add no policy.';
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 82 then
    raise exception '0054 self-check FAILED: fn_* count is %, expected 82.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  foreach f in array array['fn_admin_billing_health','fn_admin_subscriptions','fn_admin_signups'] loop
    if (select pg_get_functiondef(oid) from pg_proc where proname=f and pronamespace='public'::regnamespace)
         not like '%perform fn_require_platform_admin();%' then
      raise exception '0054 self-check FAILED: % does not require a platform admin.', f;
    end if;
    if (select count(*) from pg_proc p where p.proname=f and p.pronamespace='public'::regnamespace
          and has_function_privilege('anon', p.oid, 'execute')) <> 0 then
      raise exception '0054 self-check FAILED: anon can call %.', f;
    end if;
    if (select count(*) from pg_proc p where p.proname=f and p.pronamespace='public'::regnamespace
          and not p.prosecdef) <> 0 then
      raise exception '0054 self-check FAILED: % is not SECURITY DEFINER.', f;
    end if;
  end loop;
  if (select pg_get_functiondef(oid) from pg_proc where proname='fn_admin_billing_health'
        and pronamespace='public'::regnamespace) like '%payload%' then
    raise exception '0054 self-check FAILED: fn_admin_billing_health mentions payload.';
  end if;
  raise notice '0054 OK: three admin reads added, each refusing a non-admin before it reads; '
               '117 policies unchanged; no payload, no provider codes, no customer data.';
end
$$;
