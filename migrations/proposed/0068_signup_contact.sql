-- ============================================================================
-- MENU MASTER NG
-- 0068: a WhatsApp number from each new owner, with consent on record, and
--       the admin's check-ins
--
-- Requires: 0001-0066 applied. Independent of 0067: it may go in before or
-- after it (0067's count checks allow for the four functions added here).
--
-- WHY
--   The owner wants to reach new owners -- a welcome, a day-3 "how is it
--   going", before the trial ends, after a failed payment -- and nothing
--   collected a phone number: profiles.phone (0001) exists, but nothing ever
--   wrote it. Research of 25 Oct 2026 (Nigeria Data Protection Act 2023
--   ss.25-27 and 35, WhatsApp Business Policy) set the rules this follows:
--     * the number is OPTIONAL and asked for in onboarding, with its purpose
--       said beside it (service contact: legitimate interest, s.25);
--     * tips and offers on WhatsApp need their own, unticked consent (s.26),
--       withdrawn as easily as given (s.35);
--     * the controller must be able to prove consent (s.26(1)), so every
--       change is logged, append-only, where no client can rewrite it.
--
-- WHAT THIS ADDS
--   fn_normalise_ng_phone(text)  a Nigerian mobile in one form, 234XXXXXXXXXX,
--                                or null: 0803.., 803.., 234.., +234..,
--                                +234 (0) 803.., 00234.. (the app's
--                                lib/phone.ts is its twin).
--   profiles                     phone gets a format check; four new columns:
--                                phone_added_at, phone_confirmed_at (an
--                                admin reached them on it), marketing_ok_at
--                                (null = no offers), contact_wording (which
--                                words they saw). Clients may still READ
--                                their own row (p_profiles); they may no
--                                longer write it directly -- only through
--                                fn_set_my_contact, so no change escapes the
--                                consent log.
--   contact_consents             append-only log: who, what (service contact
--                                or WhatsApp offers), given or withdrawn,
--                                the words shown, where. RLS on, no policy,
--                                no client grant.
--   admin_checkins               the admin's contact attempts with an
--                                account: kind, channel, outcome, note. RLS
--                                on, no policy, no client grant.
--   fn_set_my_contact(...)       the signed-in person sets or clears their
--                                own number and offers choice.
--   fn_admin_checkins_due()      who to contact now and why, plus each
--                                owner's number for the admin's tables.
--   fn_admin_record_checkin(...) "Mark done": records an attempt. 'reached'
--                                on WhatsApp or a call confirms the number;
--                                'opted_out' removes it, withdraws both
--                                consents and keeps them off the list;
--                                'wrong_number' removes it and flags it for
--                                the owner; 'stopped_offers' (they replied
--                                STOP) withdraws only the offers.
--
-- WHAT DOES NOT CHANGE
--   No policy (118). fn_* +4. Invited staff never pass onboarding, so only
--   the person who set the business up is asked.
-- ============================================================================

drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0068 ABORT: this executor is not honouring transaction control '
      '(each statement is committing on its own). Run it with '
      'psql --single-transaction over the Session Pooler.';
  end if;
end
$guard$;
drop table _tx_probe;

-- the starting counts, so the self-check can prove what 0068 itself added
create temp table _mm0068_before on commit drop as
select (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') as fns,
       (select count(*) from pg_policies where schemaname='public') as pols;

-- ---------------------------------------------------------------------------
-- 1. PREFLIGHT
-- ---------------------------------------------------------------------------
do $$
declare v_fns int; v_pols int;
begin
  if to_regprocedure('public.fn_require_entitled(uuid, boolean)') is null then
    raise exception '0068 preflight FAILED: fn_require_entitled is missing. Apply 0066_trial_gate first.';
  end if;
  if to_regprocedure('public.fn_require_platform_admin()') is null then
    raise exception '0068 preflight FAILED: fn_require_platform_admin is missing (0053).';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='profiles' and column_name='phone') then
    raise exception '0068 preflight FAILED: profiles.phone (0001) is missing.';
  end if;
  if to_regclass('public.contact_consents') is not null or to_regclass('public.admin_checkins') is not null
     or exists (select 1 from pg_proc where pronamespace='public'::regnamespace
                 and proname in ('fn_normalise_ng_phone','fn_set_my_contact',
                                 'fn_admin_checkins_due','fn_admin_record_checkin')) then
    raise exception '0068 preflight FAILED: 0068 is already applied.';
  end if;
  -- Nothing has ever written profiles, so no number can break the new check.
  if exists (select 1 from profiles where phone is not null and phone !~ '^234(70|80|81|90|91)[0-9]{8}$') then
    raise exception '0068 preflight FAILED: % profile(s) hold a phone the new format check would refuse.',
      (select count(*) from profiles where phone is not null and phone !~ '^234(70|80|81|90|91)[0-9]{8}$');
  end if;

  if coalesce(current_setting('mm.fresh_install', true), '') = 'on' then
    raise notice '0068 preflight: fresh install, production baseline counts skipped.';
    return;
  end if;

  select fns, pols into v_fns, v_pols from _mm0068_before;
  if v_pols <> 118 then
    raise exception '0068 preflight FAILED: policy count is %, expected 118.', v_pols;
  end if;
  -- 102 with 0066; 107 once 0067 is in as well.
  if v_fns not in (102, 107) then
    raise exception '0068 preflight FAILED: fn_* count is %, expected 102 (0066) or 107 (0066 and 0067).', v_fns;
  end if;
  raise notice '0068 preflight OK: 118 policies, % fn_*.', v_fns;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. ONE FORM FOR A NIGERIAN MOBILE NUMBER
--
-- 234 + one of the allocated mobile prefixes (70, 80, 81, 90, 91) + 8 digits.
-- "+234 0803..." -- the 0 kept after the country code -- is the common slip
-- that made 14-digit numbers WhatsApp refuses; it is dropped here.
-- ---------------------------------------------------------------------------
create or replace function fn_normalise_ng_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $fn$
declare s text;
begin
  s := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if s like '00%' then s := substr(s, 3); end if;               -- 00234...
  if s ~ '^2340' then s := '234' || substr(s, 5); end if;       -- +234 (0) 803...
  if s ~ '^0' and length(s) = 11 then s := '234' || substr(s, 2); end if;   -- 0803...
  if length(s) = 10 and s ~ '^(70|80|81|90|91)' then s := '234' || s; end if;  -- 803...
  return case when s ~ '^234(70|80|81|90|91)[0-9]{8}$' then s end;
end;
$fn$;

comment on function fn_normalise_ng_phone(text) is
  'A Nigerian mobile number as 234XXXXXXXXXX, or null when it is not one. '
  'Accepts 0803.., 803.., 234.., +234.., +234 (0) 803.. and 00234.. with any '
  'spaces, dashes or brackets. web/src/lib/phone.ts is its twin.';

-- ---------------------------------------------------------------------------
-- 3. PROFILES: the number, when it came, whether it was confirmed, offers
-- ---------------------------------------------------------------------------
alter table profiles
  add column phone_added_at     timestamptz,
  add column phone_confirmed_at timestamptz,
  add column marketing_ok_at    timestamptz,
  add column contact_wording    text check (contact_wording is null or length(contact_wording) <= 40),
  -- an admin found the number reached someone else: it was removed, and
  -- More -> Account asks the owner for the right one
  add column phone_wrong_at     timestamptz;

alter table profiles add constraint ck_profiles_phone
  check (phone is null or phone ~ '^234(70|80|81|90|91)[0-9]{8}$');

-- Read your own row as before (p_profiles); write it only through
-- fn_set_my_contact, so every change of number or choice is logged.
revoke insert, update, delete on profiles from authenticated;

comment on column profiles.phone is
  'The person''s own WhatsApp / mobile number, 234XXXXXXXXXX, given in onboarding '
  'or More -> Account so Menu Master can help them. Never their customers'' numbers.';
comment on column profiles.marketing_ok_at is
  'When they ticked "tips and offers on WhatsApp"; null means no. Cleared on withdrawal.';

-- ---------------------------------------------------------------------------
-- 4. THE CONSENT LOG (append-only) AND THE ADMIN'S CHECK-INS
-- ---------------------------------------------------------------------------
create table contact_consents (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  purpose     text not null check (purpose in ('service_contact', 'marketing_whatsapp')),
  granted     boolean not null,
  -- the number the choice was about, so the record shows which one
  phone       text check (phone is null or phone ~ '^234(70|80|81|90|91)[0-9]{8}$'),
  wording     text check (wording is null or length(wording) <= 40),
  source      text not null check (source in ('onboarding', 'account', 'admin')),
  created_at  timestamptz not null default now()
);
create index contact_consents_user_idx on contact_consents (user_id, created_at);
alter table contact_consents enable row level security;
revoke all on contact_consents from anon, authenticated;
comment on table contact_consents is
  'Append-only record of each person''s contact choices (NDPA s.26(1): the '
  'controller proves consent). Written only by fn_set_my_contact and '
  'fn_admin_record_checkin. No client role may read or write it.';

create table admin_checkins (
  id          bigint generated always as identity primary key,
  account_id  uuid not null references accounts(id) on delete cascade,
  kind        text not null check (kind in ('welcome', 'day3', 'trial_end', 'payment_failed', 'other')),
  channel     text not null check (channel in ('whatsapp', 'call', 'email')),
  outcome     text not null check (outcome in ('reached', 'no_reply', 'wrong_number', 'opted_out', 'stopped_offers')),
  note        text check (note is null or length(note) <= 500),
  done_by     uuid references auth.users(id) on delete set null,
  done_at     timestamptz not null default now()
);
create index admin_checkins_account_idx on admin_checkins (account_id, done_at desc);
create index admin_checkins_done_by_idx on admin_checkins (done_by);   -- every FK covered (0052 rule)
alter table admin_checkins enable row level security;
revoke all on admin_checkins from anon, authenticated;
comment on table admin_checkins is
  'A platform admin''s contact attempts with an account. Written only by '
  'fn_admin_record_checkin, read only by fn_admin_checkins_due.';

-- ---------------------------------------------------------------------------
-- 5. SETTING ONE'S OWN NUMBER
-- ---------------------------------------------------------------------------
create or replace function fn_set_my_contact(
  p_phone        text,
  p_marketing_ok boolean,
  p_wording      text default null,
  p_source       text default 'onboarding'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_phone text;
  v_mkt   boolean;
  v_old   profiles%rowtype;
  v_had   boolean;
  v_had_mkt boolean;
  v_changed boolean;
  v_wording text := nullif(left(trim(coalesce(p_wording, '')), 40), '');
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_source is null or p_source not in ('onboarding', 'account') then
    raise exception 'Unknown place: %', p_source using errcode = '22023';
  end if;

  if nullif(trim(coalesce(p_phone, '')), '') is not null then
    v_phone := fn_normalise_ng_phone(p_phone);
    if v_phone is null then
      raise exception 'Use a Nigerian mobile number, like 0803 123 4567.' using errcode = '22023';
    end if;
  end if;
  -- No number, no offers on WhatsApp.
  v_mkt := v_phone is not null and coalesce(p_marketing_ok, false);

  select * into v_old from profiles where id = v_uid for update;
  v_had     := found and v_old.phone is not null;
  v_had_mkt := found and v_old.marketing_ok_at is not null;
  -- one number replaced by another: the choice is about the new one now
  v_changed := v_had and v_phone is not null and v_old.phone <> v_phone;

  insert into profiles as p (id, phone, phone_added_at, marketing_ok_at, contact_wording)
  values (v_uid, v_phone, case when v_phone is null then null else now() end,
          case when v_mkt then now() end, v_wording)
  on conflict (id) do update set
    phone              = excluded.phone,
    phone_added_at     = case when p.phone is not distinct from excluded.phone then p.phone_added_at
                              else excluded.phone_added_at end,
    phone_confirmed_at = case when p.phone is not distinct from excluded.phone then p.phone_confirmed_at end,
    -- offers belong to the number they were ticked for: a new number starts afresh
    marketing_ok_at    = case when not v_mkt then null
                              when p.phone is not distinct from excluded.phone then coalesce(p.marketing_ok_at, now())
                              else now() end,
    -- a number given again replaces the one an admin found wrong
    phone_wrong_at     = case when excluded.phone is null then p.phone_wrong_at end,
    contact_wording    = coalesce(excluded.contact_wording, p.contact_wording);

  -- The log: one row for each choice that changed, naming the number.
  if v_had is distinct from (v_phone is not null) or v_changed then
    insert into contact_consents (user_id, purpose, granted, phone, wording, source)
    values (v_uid, 'service_contact', v_phone is not null, coalesce(v_phone, v_old.phone), v_wording, p_source);
  end if;
  if v_had_mkt is distinct from v_mkt or (v_changed and v_mkt) then
    insert into contact_consents (user_id, purpose, granted, phone, wording, source)
    values (v_uid, 'marketing_whatsapp', v_mkt, coalesce(v_phone, v_old.phone), v_wording, p_source);
  end if;

  return jsonb_build_object('phone', v_phone, 'marketing_ok', v_mkt);
end;
$fn$;

comment on function fn_set_my_contact(text, boolean, text, text) is
  'The signed-in person sets or clears their own WhatsApp number and their '
  '"tips and offers" choice. An empty number clears both. Refuses a number '
  'that is not a Nigerian mobile (22023). Logs every change in contact_consents.';

-- ---------------------------------------------------------------------------
-- 6. THE ADMIN: who to contact now, and what happened
-- ---------------------------------------------------------------------------
create or replace function fn_admin_checkins_due()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare v jsonb;
begin
  perform fn_require_platform_admin();

  with owners as (
    select distinct on (m.account_id) m.account_id, m.user_id
      from memberships m where m.role = 'owner'
     order by m.account_id, m.created_at
  ), acc as (
    select a.id, a.name, a.created_at, u.email, p.phone, p.phone_confirmed_at, p.marketing_ok_at, p.phone_wrong_at,
           s.status, s.trial_ends_at, fn_account_is_entitled(a.id) as entitled,
           -- asked not to be contacted, and has not given a number since
           exists (select 1 from admin_checkins c where c.account_id = a.id and c.outcome = 'opted_out'
                    and (p.phone_added_at is null or c.done_at > p.phone_added_at)) as opted_out
      from accounts a
      left join owners o on o.account_id = a.id
      left join auth.users u on u.id = o.user_id
      left join profiles p on p.id = o.user_id
      left join subscriptions s on s.account_id = a.id
     where a.deleted_at is null
  ), last_ci as (
    select distinct on (c.account_id) c.account_id, c.kind, c.outcome, c.done_at
      from admin_checkins c order by c.account_id, c.done_at desc
  ), done as (
    -- A check-in closes its reason, except "no reply", which comes back a day later.
    select c.account_id, c.kind, c.done_at
      from admin_checkins c
     where c.outcome <> 'no_reply' or c.done_at > now() - interval '1 day'
  ), due as (
    select acc.*, r.reason, r.rank
      from acc
      cross join lateral (values
        (case when acc.status = 'past_due'
                   and not exists (select 1 from done d where d.account_id = acc.id
                                     and d.kind = 'payment_failed' and d.done_at >= now() - interval '7 days')
              then 'payment_failed' end, 1),
        (case when acc.status = 'trialing' and acc.entitled
                   and acc.trial_ends_at between now() and now() + interval '2 days'
                   and not exists (select 1 from done d where d.account_id = acc.id and d.kind = 'trial_end')
              then 'trial_end' end, 2),
        (case when acc.created_at >= now() - interval '2 days'
                   and not exists (select 1 from done d where d.account_id = acc.id and d.kind = 'welcome')
              then 'welcome' end, 3),
        (case when acc.created_at < now() - interval '3 days' and acc.created_at >= now() - interval '6 days'
                   and not exists (select 1 from done d where d.account_id = acc.id and d.kind = 'day3')
              then 'day3' end, 4)
      ) as r(reason, rank)
     where r.reason is not null
       and not acc.opted_out            -- they asked not to be contacted
  )
  select jsonb_build_object(
    'due', coalesce((
      select jsonb_agg(jsonb_build_object(
               'account_id', d.id, 'name', d.name, 'created_at', d.created_at,
               'owner_email', d.email, 'phone', d.phone,
               'phone_confirmed', d.phone_confirmed_at is not null,
               'phone_wrong', d.phone is null and d.phone_wrong_at is not null,
               'marketing_ok', d.marketing_ok_at is not null,
               'reason', d.reason, 'trial_ends_at', d.trial_ends_at,
               'last_kind', l.kind, 'last_outcome', l.outcome, 'last_at', l.done_at)
             order by d.rank, d.created_at desc)
        from due d left join last_ci l on l.account_id = d.id), '[]'::jsonb),
    'contacts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'account_id', acc.id, 'name', acc.name, 'owner_email', acc.email, 'phone', acc.phone,
               'phone_confirmed', acc.phone_confirmed_at is not null,
               'phone_wrong', acc.phone is null and acc.phone_wrong_at is not null,
               'marketing_ok', acc.marketing_ok_at is not null,
               'opted_out', acc.opted_out,
               'last_kind', l.kind, 'last_outcome', l.outcome, 'last_at', l.done_at)
             order by acc.created_at desc)
        from acc left join last_ci l on l.account_id = acc.id
       where acc.phone is not null or l.account_id is not null), '[]'::jsonb),
    'new_30d', (select count(*) from acc where acc.created_at >= now() - interval '30 days'),
    'new_30d_with_phone', (select count(*) from acc where acc.created_at >= now() - interval '30 days'
                                                     and acc.phone is not null)
  ) into v;
  return v;
end;
$fn$;

comment on function fn_admin_checkins_due() is
  'Platform administrators only. Accounts to contact now (a failed payment, a '
  'trial ending within 2 days, a welcome in the first 2 days, a day-3 check), '
  'each owner''s number and choices, the last check-in, and how many new '
  'owners gave a number.';

create or replace function fn_admin_record_checkin(
  p_account_id uuid,
  p_kind       text,
  p_channel    text,
  p_outcome    text,
  p_note       text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_owner uuid; v_id bigint; v_old profiles%rowtype;
begin
  perform fn_require_platform_admin();
  if not exists (select 1 from accounts where id = p_account_id and deleted_at is null) then
    raise exception 'No such account.' using errcode = 'P0002';
  end if;

  insert into admin_checkins (account_id, kind, channel, outcome, note, done_by)
  values (p_account_id, p_kind, p_channel, p_outcome, nullif(left(trim(coalesce(p_note, '')), 500), ''), auth.uid())
  returning id into v_id;

  select m.user_id into v_owner from memberships m
   where m.account_id = p_account_id and m.role = 'owner' order by m.created_at limit 1;

  if v_owner is null then
    return jsonb_build_object('id', v_id);
  end if;
  select * into v_old from profiles where id = v_owner for update;

  if p_outcome = 'reached' and p_channel in ('whatsapp', 'call') then
    -- only reaching them ON the number confirms it; an email reply does not
    update profiles set phone_confirmed_at = coalesce(phone_confirmed_at, now())
     where id = v_owner and phone is not null;

  elsif p_outcome in ('opted_out', 'wrong_number') then
    -- Asked not to be contacted, or the number reached someone else: the
    -- number goes, and so do the offers. A wrong number is flagged so More
    -- -> Account asks the owner for the right one; an opt-out keeps them out
    -- of the check-ins until they give a number again.
    if found and v_old.phone is not null then
      insert into contact_consents (user_id, purpose, granted, phone, source)
      values (v_owner, 'service_contact', false, v_old.phone, 'admin');
    end if;
    if found and v_old.marketing_ok_at is not null then
      insert into contact_consents (user_id, purpose, granted, phone, source)
      values (v_owner, 'marketing_whatsapp', false, v_old.phone, 'admin');
    end if;
    update profiles set phone = null, phone_added_at = null, phone_confirmed_at = null, marketing_ok_at = null,
                        phone_wrong_at = case when p_outcome = 'wrong_number' and phone is not null then now() else phone_wrong_at end
     where id = v_owner;

  elsif p_outcome = 'stopped_offers' then
    -- They replied STOP to tips and offers: the number stays for help, offers go.
    if found and v_old.marketing_ok_at is not null then
      insert into contact_consents (user_id, purpose, granted, phone, source)
      values (v_owner, 'marketing_whatsapp', false, v_old.phone, 'admin');
    end if;
    update profiles set marketing_ok_at = null where id = v_owner;
  end if;

  return jsonb_build_object('id', v_id);
end;
$fn$;

comment on function fn_admin_record_checkin(uuid, text, text, text, text) is
  'Platform administrators only. Records a contact attempt. ''reached'' on '
  'WhatsApp or a call marks the owner''s number confirmed; ''opted_out'' and '
  '''wrong_number'' remove it and withdraw both consents (logged; a wrong '
  'number is flagged for the owner); ''stopped_offers'' withdraws only offers.';

revoke all on function fn_normalise_ng_phone(text) from public, anon;
revoke all on function fn_set_my_contact(text, boolean, text, text) from public, anon;
revoke all on function fn_admin_checkins_due() from public, anon;
revoke all on function fn_admin_record_checkin(uuid, text, text, text, text) from public, anon;
grant execute on function fn_normalise_ng_phone(text) to authenticated;
grant execute on function fn_set_my_contact(text, boolean, text, text) to authenticated;
grant execute on function fn_admin_checkins_due() to authenticated;
grant execute on function fn_admin_record_checkin(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. SELF-CHECK
-- ---------------------------------------------------------------------------
do $$
declare v_fns int; v_pols int; b record;
begin
  select fns, pols into b from _mm0068_before;
  select count(*) into v_fns from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%';
  select count(*) into v_pols from pg_policies where schemaname='public';
  if v_pols <> b.pols then
    raise exception '0068 self-check FAILED: policy count moved from % to %; 0068 adds none.', b.pols, v_pols;
  end if;
  if v_fns <> b.fns + 4 then
    raise exception '0068 self-check FAILED: fn_* went from % to %, expected +4.', b.fns, v_fns;
  end if;

  -- the normaliser, on the ways people type a number
  if fn_normalise_ng_phone('0803 123 4567') is distinct from '2348031234567'
     or fn_normalise_ng_phone('+234 (0) 803-123-4567') is distinct from '2348031234567'
     or fn_normalise_ng_phone('+2348031234567') is distinct from '2348031234567'
     or fn_normalise_ng_phone('002348031234567') is distinct from '2348031234567'
     or fn_normalise_ng_phone('8031234567') is distinct from '2348031234567'
     or fn_normalise_ng_phone('07131234567') is not null
     or fn_normalise_ng_phone('+44 7700 900123') is not null
     or fn_normalise_ng_phone('call me') is not null then
    raise exception '0068 self-check FAILED: fn_normalise_ng_phone does not read the test numbers right.';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.contact_consents'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.admin_checkins'::regclass) then
    raise exception '0068 self-check FAILED: RLS is off on a new table.';
  end if;
  if has_table_privilege('authenticated', 'contact_consents', 'select,insert,update,delete')
     or has_table_privilege('anon', 'contact_consents', 'select,insert,update,delete')
     or has_table_privilege('authenticated', 'admin_checkins', 'select,insert,update,delete')
     or has_table_privilege('anon', 'admin_checkins', 'select,insert,update,delete') then
    raise exception '0068 self-check FAILED: a client role can reach the consent log or the check-ins.';
  end if;
  if has_table_privilege('authenticated', 'profiles', 'insert')
     or has_table_privilege('authenticated', 'profiles', 'update')
     or has_table_privilege('authenticated', 'profiles', 'delete') then
    raise exception '0068 self-check FAILED: a client may still write profiles directly.';
  end if;
  if not has_table_privilege('authenticated', 'profiles', 'select') then
    raise exception '0068 self-check FAILED: a person can no longer read their own profile.';
  end if;
  if has_function_privilege('anon', 'fn_set_my_contact(text, boolean, text, text)', 'execute')
     or has_function_privilege('anon', 'fn_admin_checkins_due()', 'execute')
     or has_function_privilege('anon', 'fn_admin_record_checkin(uuid, text, text, text, text)', 'execute') then
    raise exception '0068 self-check FAILED: anon may call a 0068 function.';
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and prosecdef
        and proname in ('fn_set_my_contact', 'fn_admin_checkins_due', 'fn_admin_record_checkin')) <> 3 then
    raise exception '0068 self-check FAILED: a 0068 function is not security definer.';
  end if;

  if coalesce(current_setting('mm.fresh_install', true), '') <> 'on'
     and (v_pols <> 118 or v_fns not in (106, 111)) then
    raise exception '0068 self-check FAILED: expected 118 policies and 106 (or 111 with 0067) fn_*, found % and %.', v_pols, v_fns;
  end if;
  raise notice '0068 OK: profiles take a checked WhatsApp number; consent log and check-ins in place; 118 policies, % fn_*.', v_fns;
end
$$;
