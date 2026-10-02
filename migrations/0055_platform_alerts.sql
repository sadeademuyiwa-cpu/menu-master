-- ============================================================================
-- MENU MASTER NG
-- 0055: alerts -- the database noticing, so a person does not have to
--
-- Requires: 0001-0054 applied.
--
-- 0027 said it plainly: "A VIEW IS NOT AN ALERT -- whatever runs the sweeper
-- must notify a human when a failed_permanent row appears." Nothing did.
-- This adds:
--
--   platform_alerts        one row per condition per subject, opened when
--                          first seen, refreshed while it persists, resolved
--                          (never deleted) when it clears
--   fn_admin_scan()        service context only. Looks at the conditions
--                          below and opens/refreshes/resolves rows. Safe to
--                          run any number of times: a second run adds nothing.
--   fn_admin_alerts(open)  admin read of the rows
--   fn_admin_resolve_alert admin marks a row handled, with a note
--   a pg_cron schedule     hourly, IF pg_cron is enabled on this database
--                          (see the runbook); otherwise a notice says so
--
-- CONDITIONS
--   billing_failed_permanent  a billing event that will never apply
--   billing_stuck             an event received/processing > 15 min, or
--                             transient-failed 3+ times
--   founder_slots_low         10 or fewer founding slots free
--   founder_slots_exhausted   none free
--   past_due_beyond_grace     a past_due subscription past its grace, i.e.
--                             an account the entitlement gate has now closed
--   subscription_no_period    a subscription with no period end (v_billing_anomalies)
--
-- Email is NOT sent from here. A mailer edge function reads rows whose
-- notified_at is null and stamps them (supabase/functions/platform-alert-mailer).
-- ============================================================================

drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0055 ABORT: this executor is not honouring transaction control '
      '(each statement is committing on its own). Run it with '
      'psql --single-transaction over the Session Pooler.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from pg_proc where proname='fn_admin_subscriptions'
                   and pronamespace='public'::regnamespace) then
    raise exception '0055 preflight FAILED: fn_admin_subscriptions is missing. Apply 0054 first.';
  end if;
  if exists (select 1 from pg_class where relname='platform_alerts' and relnamespace='public'::regnamespace) then
    raise exception '0055 preflight FAILED: platform_alerts already exists.';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 117 then
    raise exception '0055 preflight FAILED: policy count is %, expected 117.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 82 then
    raise exception '0055 preflight FAILED: fn_* count is %, expected 82.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table platform_alerts (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,
  severity     text not null check (severity in ('info','warn','critical')),
  subject      text not null,                 -- what the alert is about: an event id, an account id, 'founder_slots'
  summary      text not null,                 -- one plain sentence
  detail       jsonb not null default '{}'::jsonb,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references auth.users(id) on delete set null,
  resolution   text,
  notified_at  timestamptz,
  constraint ck_platform_alerts_kind check (kind in (
    'billing_failed_permanent','billing_stuck','founder_slots_low',
    'founder_slots_exhausted','past_due_beyond_grace','subscription_no_period'))
);

-- one OPEN row per condition per subject; a resolved one may recur as a new row
create unique index ux_platform_alerts_open on platform_alerts (kind, subject) where resolved_at is null;
create index ix_platform_alerts_unnotified on platform_alerts (first_seen) where notified_at is null;
create index ix_fk_platform_alerts_resolved_by on platform_alerts (resolved_by);

comment on table platform_alerts is
  'What the platform noticed about itself. Opened by fn_admin_scan, resolved '
  'by the scan when the condition clears or by an admin with a note; never '
  'deleted. notified_at is stamped by the mailer.';

alter table platform_alerts enable row level security;
revoke all on platform_alerts from public, anon, authenticated;
revoke delete, truncate on platform_alerts from service_role;

-- ---------------------------------------------------------------------------
-- 2. The scan
-- ---------------------------------------------------------------------------
create or replace function fn_admin_scan()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_opened int := 0; v_refreshed int := 0; v_resolved int := 0;
  v_free int; v_grace interval;
  c record;
begin
  if not fn_is_service_context() then
    raise exception 'fn_admin_scan is a service-context function'
      using errcode = '42501';
  end if;

  create temp table _seen (kind text, subject text, severity text, summary text, detail jsonb) on commit drop;

  -- billing: permanent failures
  insert into _seen
  select 'billing_failed_permanent', e.id::text, 'critical',
         'A billing event will never apply: '||coalesce(e.last_error_code,'?')||' ('||coalesce(e.event_type,'?')||').',
         jsonb_build_object('event_id', e.id, 'event_type', e.event_type, 'reference', e.reference,
                            'account_id', e.account_id, 'error_code', e.last_error_code,
                            'error', e.last_error, 'received_at', e.received_at)
    from billing_events e where e.status = 'failed_permanent';

  -- billing: stuck
  insert into _seen
  select 'billing_stuck', e.id::text, 'warn',
         'A billing event has been '||e.status||' for too long ('||e.attempts||' attempt(s)).',
         jsonb_build_object('event_id', e.id, 'event_type', e.event_type, 'reference', e.reference,
                            'account_id', e.account_id, 'status', e.status, 'attempts', e.attempts,
                            'error_code', e.last_error_code, 'received_at', e.received_at)
    from billing_events e
   where (e.status in ('received','processing') and e.received_at < now() - interval '15 minutes')
      or (e.status = 'failed_transient' and e.attempts >= 3);

  -- founder slots
  select count(*) into v_free from founder_slots where account_id is null;
  if v_free = 0 then
    insert into _seen values ('founder_slots_exhausted', 'founder_slots', 'critical',
      'Every founding slot is taken. The founding price can no longer be offered.',
      jsonb_build_object('free', 0));
  elsif v_free <= 10 then
    insert into _seen values ('founder_slots_low', 'founder_slots', 'warn',
      v_free||' founding slot(s) left.', jsonb_build_object('free', v_free));
  end if;

  -- past due beyond grace: the gate has closed on a paying customer
  v_grace := fn_payment_failure_grace();
  insert into _seen
  select 'past_due_beyond_grace', s.account_id::text, 'warn',
         'A subscription is past due beyond the '||v_grace||' grace; the account can no longer record work.',
         jsonb_build_object('account_id', s.account_id, 'plan_id', s.plan_id,
                            'current_period_end', s.current_period_end, 'grace', v_grace::text)
    from subscriptions s
   where s.status = 'past_due' and s.current_period_end + v_grace < now();

  -- anomalies
  insert into _seen
  select 'subscription_no_period', a.subscription_id::text, 'warn',
         'A subscription has no period end.',
         jsonb_build_object('subscription_id', a.subscription_id, 'account_id', a.account_id, 'status', a.status)
    from v_billing_anomalies a;

  -- refresh what is still true
  update platform_alerts p
     set last_seen = now(), severity = s.severity, summary = s.summary, detail = s.detail
    from _seen s
   where p.kind = s.kind and p.subject = s.subject and p.resolved_at is null;
  get diagnostics v_refreshed = row_count;

  -- open what is new
  insert into platform_alerts (kind, subject, severity, summary, detail)
  select s.kind, s.subject, s.severity, s.summary, s.detail
    from _seen s
   where not exists (select 1 from platform_alerts p
                      where p.kind = s.kind and p.subject = s.subject and p.resolved_at is null);
  get diagnostics v_opened = row_count;

  -- resolve what has cleared (only the scan's own kinds; an admin's note is kept)
  update platform_alerts p
     set resolved_at = now(), resolution = coalesce(resolution, 'cleared: the condition is no longer present')
   where p.resolved_at is null
     and not exists (select 1 from _seen s where s.kind = p.kind and s.subject = p.subject);
  get diagnostics v_resolved = row_count;

  drop table _seen;
  return jsonb_build_object('opened', v_opened, 'refreshed', v_refreshed, 'resolved', v_resolved,
                            'open', (select count(*) from platform_alerts where resolved_at is null));
end;
$fn$;

revoke all on function fn_admin_scan() from public, anon, authenticated;
grant execute on function fn_admin_scan() to service_role;

comment on function fn_admin_scan() is
  'Service context only. Opens, refreshes and resolves platform_alerts from '
  'the current state of billing_events, founder_slots and subscriptions. '
  'Idempotent: running it twice changes nothing the second time.';

-- ---------------------------------------------------------------------------
-- 3. The admin's reads and the one admin write
-- ---------------------------------------------------------------------------
create or replace function fn_admin_alerts(p_open_only boolean default true)
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
    'open',     (select count(*) from platform_alerts where resolved_at is null),
    'critical', (select count(*) from platform_alerts where resolved_at is null and severity='critical'),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(a) order by
               case a.severity when 'critical' then 0 when 'warn' then 1 else 2 end, a.first_seen desc)
        from (select * from platform_alerts
               where (not coalesce(p_open_only, true)) or resolved_at is null
               order by first_seen desc limit 500) a), '[]'::jsonb)
  ) into v;
  return v;
end;
$fn$;

revoke all on function fn_admin_alerts(boolean) from public, anon;
grant execute on function fn_admin_alerts(boolean) to authenticated, service_role;

create or replace function fn_admin_resolve_alert(p_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare r platform_alerts%rowtype;
begin
  perform fn_require_platform_admin();
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'Say what was done about it' using errcode = '22023';
  end if;
  update platform_alerts
     set resolved_at = now(), resolved_by = auth.uid(), resolution = trim(p_note)
   where id = p_id and resolved_at is null
   returning * into r;
  if r.id is null then
    raise exception 'No open alert with that id' using errcode = 'P0002';
  end if;
  return to_jsonb(r);
end;
$fn$;

revoke all on function fn_admin_resolve_alert(uuid, text) from public, anon;
grant execute on function fn_admin_resolve_alert(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The schedule, where pg_cron exists
--
-- Not `create extension` here: on Supabase the extension is enabled from the
-- dashboard and the migration must not depend on being allowed to. Where it
-- is present the scan runs hourly as the job owner (the service context).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mm-admin-scan', '7 * * * *', 'select public.fn_admin_scan();');
    raise notice '0055: pg_cron job mm-admin-scan scheduled hourly.';
  else
    raise notice '0055: pg_cron is not enabled on this database; fn_admin_scan() is not scheduled. '
                 'Enable pg_cron and run deploy/runbook/SCHEDULE_ADMIN_SCAN.sql, or call it from the mailer.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Self-check
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  if (select count(*) from pg_policies where schemaname='public') <> 117 then
    raise exception '0055 self-check FAILED: 0055 must add no policy.';
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 85 then
    raise exception '0055 self-check FAILED: fn_* count is %, expected 85.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  if has_table_privilege('authenticated','platform_alerts','select')
     or has_table_privilege('anon','platform_alerts','select') then
    raise exception '0055 self-check FAILED: a client role can read platform_alerts.';
  end if;
  if has_function_privilege('authenticated','fn_admin_scan()','execute')
     or has_function_privilege('anon','fn_admin_scan()','execute') then
    raise exception '0055 self-check FAILED: a client role can run the scan.';
  end if;
  -- the scan runs, and running it again changes nothing
  v := fn_admin_scan();
  if (fn_admin_scan()->>'opened')::int <> 0 then
    raise exception '0055 self-check FAILED: a second scan opened new rows.';
  end if;
  raise notice '0055 OK: platform_alerts, fn_admin_scan (first run: %), fn_admin_alerts and '
               'fn_admin_resolve_alert added; 117 policies unchanged.', v::text;
end
$$;
