-- ============================================================================
-- MENU MASTER NG
-- 0058: reminding an owner that their free trial is ending
--
-- Requires: 0001-0057 applied.
--
-- WHY
--   Owners did not know they were on a trial. The app now says so on every
--   page, but an owner who has not opened it for a week still learns only
--   when they can no longer save. Three emails close that gap:
--     ends_in_3_days   the trial ends within three days
--     ends_tomorrow    it ends within a day
--     ended            it ended in the last seven days and is still unpaid
--   Each is sent at most once per account, ever.
--
-- HOW
--   trial_reminders                 one row per (account, kind) actually sent.
--                                   RLS on, NO policy, no client grant: like
--                                   billing_events and platform_alerts, only
--                                   the service context touches it.
--   fn_trial_reminders_due()        service context only. Which reminders are
--                                   owed now, with the owner's email. The
--                                   trial boundary is current_period_end for a
--                                   'trialing' subscription -- the very date
--                                   fn_account_is_entitled closes the account
--                                   on, so the email can never disagree with
--                                   the app.
--   fn_record_trial_reminder(...)   service context only. Notes one as sent.
--
--   The sending is done by supabase/functions/trial-reminder-mailer, on a
--   schedule, with the mail key in the Edge Function secret store.
--
-- WHAT DOES NOT CHANGE
--   No policy (118 before and after). No customer row is written. A paying
--   account ('active', 'past_due', 'cancelled') is never reminded: only
--   'trialing' subscriptions qualify.
-- ============================================================================

drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0058 ABORT: this executor is not honouring transaction control '
      '(each statement is committing on its own). Run it with '
      'psql --single-transaction over the Session Pooler.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from pg_class where relname='site_settings' and relnamespace='public'::regnamespace) then
    raise exception '0058 preflight FAILED: site_settings is missing. Apply 0057 first.';
  end if;
  if exists (select 1 from pg_class where relname='trial_reminders' and relnamespace='public'::regnamespace) then
    raise exception '0058 preflight FAILED: trial_reminders already exists.';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 118 then
    raise exception '0058 preflight FAILED: policy count is %, expected 118.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 93 then
    raise exception '0058 preflight FAILED: fn_* count is %, expected 93.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. What was sent
-- ---------------------------------------------------------------------------
create table trial_reminders (
  account_id  uuid not null references accounts(id) on delete cascade,
  kind        text not null,
  sent_to     text not null,
  sent_at     timestamptz not null default now(),
  primary key (account_id, kind),
  constraint ck_trial_reminders_kind check (kind in ('ends_in_3_days', 'ends_tomorrow', 'ended'))
);

comment on table trial_reminders is
  'One row per trial reminder email actually sent. Service context only: RLS '
  'on, no policy, no client grant. Rows are kept so no account is reminded twice.';

alter table trial_reminders enable row level security;
revoke all on trial_reminders from public, anon, authenticated;
grant select, insert on trial_reminders to service_role;

-- ---------------------------------------------------------------------------
-- 2. What is owed now
-- ---------------------------------------------------------------------------
create or replace function fn_trial_reminders_due()
returns table (
  account_id     uuid,
  kind           text,
  owner_email    text,
  business_name  text,
  trial_ends_at  timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
#variable_conflict use_column
begin
  if not fn_is_service_context() then
    raise exception 'fn_trial_reminders_due is a service-context function' using errcode = '42501';
  end if;
  return query
  with t as (
    select s.account_id, s.current_period_end as ends,
           case
             when s.current_period_end <= now()                      then 'ended'
             when s.current_period_end <= now() + interval '1 day'   then 'ends_tomorrow'
             when s.current_period_end <= now() + interval '3 days'  then 'ends_in_3_days'
           end as kind
      from subscriptions s
      join accounts a on a.id = s.account_id and a.deleted_at is null
     where s.status = 'trialing'
       and s.current_period_end is not null
       and s.current_period_end >  now() - interval '7 days'
       and s.current_period_end <= now() + interval '3 days'
  )
  select t.account_id, t.kind::text,
         (select u.email::text from memberships m join auth.users u on u.id = m.user_id
           where m.account_id = t.account_id and m.role = 'owner'
           order by m.created_at limit 1),
         coalesce((select b.name::text from businesses b
                    where b.account_id = t.account_id and b.deleted_at is null
                    order by b.created_at limit 1),
                  (select a.name::text from accounts a where a.id = t.account_id)),
         t.ends
    from t
   where not exists (select 1 from trial_reminders r where r.account_id = t.account_id and r.kind = t.kind)
     -- once told it HAS ended, never then told it is ending
     and not exists (select 1 from trial_reminders r where r.account_id = t.account_id and r.kind = 'ended')
     and (select u.email from memberships m join auth.users u on u.id = m.user_id
           where m.account_id = t.account_id and m.role = 'owner' order by m.created_at limit 1) is not null
   order by t.ends;
end;
$fn$;

revoke all on function fn_trial_reminders_due() from public, anon, authenticated;
grant execute on function fn_trial_reminders_due() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Noting one as sent
-- ---------------------------------------------------------------------------
create or replace function fn_record_trial_reminder(p_account_id uuid, p_kind text, p_sent_to text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_n int;
begin
  if not fn_is_service_context() then
    raise exception 'fn_record_trial_reminder is a service-context function' using errcode = '42501';
  end if;
  insert into trial_reminders (account_id, kind, sent_to)
  values (p_account_id, p_kind, p_sent_to)
  on conflict (account_id, kind) do nothing;
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$fn$;

revoke all on function fn_record_trial_reminder(uuid, text, text) from public, anon, authenticated;
grant execute on function fn_record_trial_reminder(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Self-check
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  if (select count(*) from pg_policies where schemaname='public') <> 118 then
    raise exception '0058 self-check FAILED: 0058 must add no policy.';
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 95 then
    raise exception '0058 self-check FAILED: fn_* count is %, expected 95.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  if not (select relrowsecurity from pg_class where relname='trial_reminders') then
    raise exception '0058 self-check FAILED: RLS is not enabled on trial_reminders.';
  end if;
  if has_table_privilege('authenticated','trial_reminders','select')
     or has_table_privilege('anon','trial_reminders','select') then
    raise exception '0058 self-check FAILED: a client role can read trial_reminders (and owners'' emails).';
  end if;
  foreach f in array array['fn_trial_reminders_due','fn_record_trial_reminder'] loop
    if (select count(*) from pg_proc p where p.proname=f and p.pronamespace='public'::regnamespace
          and (has_function_privilege('anon', p.oid, 'execute')
               or has_function_privilege('authenticated', p.oid, 'execute'))) <> 0 then
      raise exception '0058 self-check FAILED: a client role can call %.', f;
    end if;
    if (select count(*) from pg_proc p where p.proname=f and p.pronamespace='public'::regnamespace
          and not exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public')) <> 0 then
      raise exception '0058 self-check FAILED: % does not pin search_path.', f;
    end if;
  end loop;
  raise notice '0058 OK: trial_reminders (RLS, no policy, no client grant), fn_trial_reminders_due and '
               'fn_record_trial_reminder (service context only); 118 policies unchanged.';
end
$$;
