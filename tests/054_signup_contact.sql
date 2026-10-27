-- ============================================================================
-- MENU MASTER NG -- tests/054_signup_contact.sql
--
-- Acceptance test for 0068. Run on a database with 0068 applied (with or
-- without 0067). Rolls everything back.
--
-- An owner's WhatsApp number is theirs: they set and clear it themselves,
-- in one checked form, and every change of choice is on record where no
-- client can rewrite it. Only a platform admin sees the numbers, and only
-- through the check-ins.
-- ============================================================================

begin;

create temp table t54 (n int, check_name text, verdict text, detail text) on commit drop;

create or replace function pg_temp.u(n int) returns uuid language sql immutable as
$$ select ('00000054-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

insert into auth.users (id, email)
select pg_temp.u(n), 'u' || n || '@t54.test' from unnest(array[1, 2, 3, 9]) n;
insert into platform_admins (user_id, reason) values (pg_temp.u(9), 'test 054');

-- Runs p_sql as p_user (authenticated) or as anon (null), rolled back; returns 'ok' or the SQLSTATE.
create or replace function pg_temp.try(p_user uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
    perform set_config('role', case when p_user is null then 'anon' else 'authenticated' end, true);
    execute p_sql;
    raise exception 'probe rolled back' using errcode = 'MM000';
  exception when others then v := sqlstate;
  end;
  return case when v = 'MM000' then 'ok' else v end;
end $$;

-- Runs p_sql as p_user and keeps the effect.
create or replace function pg_temp.as_user(p_user uuid, p_sql text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create temp table fx (k text primary key, acct uuid) on commit drop;
insert into fx
select 'A', (e->>'account_id')::uuid
  from fn_create_account_and_business('T54 A', 'T54 A Kitchen', 'caterer', pg_temp.u(1), p_idempotency_key => 't54-a') e
union all
select 'B', (e->>'account_id')::uuid
  from fn_create_account_and_business('T54 B', 'T54 B Kitchen', 'caterer', pg_temp.u(2), p_idempotency_key => 't54-b') e;
-- grant the temp table to the client roles the probes switch to
grant select on fx to authenticated, anon;

-- ============================================ 1. one form for a number
insert into t54 values (1, 'the ways people type a Nigerian mobile all become 234...',
  case when fn_normalise_ng_phone('0803 123 4567') = '2348031234567'
        and fn_normalise_ng_phone('+234 (0) 803-123-4567') = '2348031234567'
        and fn_normalise_ng_phone('+2348031234567') = '2348031234567'
        and fn_normalise_ng_phone('002348031234567') = '2348031234567'
        and fn_normalise_ng_phone('8031234567') = '2348031234567'
        and fn_normalise_ng_phone('0901 234 5678') = '2349012345678'
       then 'PASS' else 'FAIL' end, '');
insert into t54 values (2, 'and anything else is no number at all',
  case when fn_normalise_ng_phone('07131234567') is null and fn_normalise_ng_phone('+44 7700 900123') is null
        and fn_normalise_ng_phone('') is null and fn_normalise_ng_phone(null) is null
        and fn_normalise_ng_phone('080312345') is null
       then 'PASS' else 'FAIL' end, '');

-- ============================================ 2. an owner sets their own number
select pg_temp.as_user(pg_temp.u(1), $q$ select fn_set_my_contact('0803 123 4567', false, 'onboarding-v1', 'onboarding') $q$);

insert into t54 values (3, 'the number is stored in its one form, offers off',
  case when (select phone from profiles where id = pg_temp.u(1)) = '2348031234567'
        and (select marketing_ok_at from profiles where id = pg_temp.u(1)) is null
        and (select phone_added_at from profiles where id = pg_temp.u(1)) is not null
        and (select contact_wording from profiles where id = pg_temp.u(1)) = 'onboarding-v1'
       then 'PASS' else 'FAIL' end, (select phone from profiles where id = pg_temp.u(1)));
insert into t54 values (4, 'and the log shows the service-contact choice, nothing about offers',
  case when (select string_agg(purpose || ':' || granted || ':' || source, ',' order by id)
               from contact_consents where user_id = pg_temp.u(1)) = 'service_contact:true:onboarding'
       then 'PASS' else 'FAIL' end,
  (select string_agg(purpose || ':' || granted, ',' order by id) from contact_consents where user_id = pg_temp.u(1)));

insert into t54 values (5, 'a number that is not a Nigerian mobile is refused (22023)',
  case when pg_temp.try(pg_temp.u(1), $q$ select fn_set_my_contact('12345', false) $q$) = '22023'
       then 'PASS' else 'FAIL' end, pg_temp.try(pg_temp.u(1), $q$ select fn_set_my_contact('12345', false) $q$));
insert into t54 values (6, 'an unknown place is refused (22023)',
  case when pg_temp.try(pg_temp.u(1), $q$ select fn_set_my_contact('08031234567', false, null, 'banner') $q$) = '22023'
       then 'PASS' else 'FAIL' end, '');

-- offers: on, then off again
select pg_temp.as_user(pg_temp.u(1), $q$ select fn_set_my_contact('08031234567', true, 'account-v1', 'account') $q$);
insert into t54 values (7, 'ticking offers records when, and logs it',
  case when (select marketing_ok_at from profiles where id = pg_temp.u(1)) is not null
        and exists (select 1 from contact_consents where user_id = pg_temp.u(1)
                     and purpose = 'marketing_whatsapp' and granted and source = 'account')
       then 'PASS' else 'FAIL' end, '');
insert into t54 values (8, 'the same number again does not log a second service-contact row',
  case when (select count(*) from contact_consents where user_id = pg_temp.u(1) and purpose = 'service_contact') = 1
       then 'PASS' else 'FAIL' end, '');
select pg_temp.as_user(pg_temp.u(1), $q$ select fn_set_my_contact('08031234567', false, null, 'account') $q$);
insert into t54 values (9, 'unticking offers is as easy, and logged as withdrawn (NDPA s.35)',
  case when (select marketing_ok_at from profiles where id = pg_temp.u(1)) is null
        and exists (select 1 from contact_consents where user_id = pg_temp.u(1)
                     and purpose = 'marketing_whatsapp' and not granted)
       then 'PASS' else 'FAIL' end, '');

-- offers without a number are not kept
select pg_temp.as_user(pg_temp.u(2), $q$ select fn_set_my_contact('', true, 'onboarding-v1', 'onboarding') $q$);
insert into t54 values (10, 'no number means no offers, whatever the box said',
  case when (select marketing_ok_at from profiles where id = pg_temp.u(2)) is null
        and not exists (select 1 from contact_consents where user_id = pg_temp.u(2))
       then 'PASS' else 'FAIL' end, '');

-- ============================================ 3. what clients may and may not do
insert into t54 values (11, 'an owner reads their own profile',
  case when pg_temp.try(pg_temp.u(1), $q$ select phone from profiles where id = auth.uid() $q$) = 'ok'
       then 'PASS' else 'FAIL' end, '');
do $$
declare v int;
begin
  perform set_config('request.jwt.claim.sub', pg_temp.u(2)::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v from profiles where id = pg_temp.u(1);
  perform set_config('role', 'postgres', true);
  insert into t54 values (12, 'but never someone else''s number',
    case when v = 0 then 'PASS' else 'FAIL' end, v::text);
end $$;
insert into t54 values (13, 'an owner cannot write profiles directly, so no change escapes the log (42501)',
  case when pg_temp.try(pg_temp.u(1), $q$ update profiles set phone = '2348000000000' where id = auth.uid() $q$) = '42501'
        and pg_temp.try(pg_temp.u(3), $q$ insert into profiles (id, phone) values (auth.uid(), '2348031234567') $q$) = '42501'
        and pg_temp.try(pg_temp.u(1), $q$ delete from profiles where id = auth.uid() $q$) = '42501'
       then 'PASS' else 'FAIL' end,
  pg_temp.try(pg_temp.u(1), $q$ update profiles set phone = '2348000000000' where id = auth.uid() $q$));
insert into t54 values (14, 'nobody reads or writes the consent log or the check-ins from a client (42501)',
  case when pg_temp.try(pg_temp.u(1), $q$ select count(*) from contact_consents $q$) = '42501'
        and pg_temp.try(pg_temp.u(1), $q$ insert into contact_consents (user_id, purpose, granted, source)
                                           values (auth.uid(), 'service_contact', false, 'account') $q$) = '42501'
        and pg_temp.try(pg_temp.u(9), $q$ select count(*) from admin_checkins $q$) = '42501'
       then 'PASS' else 'FAIL' end, '');
insert into t54 values (15, 'a visitor who is not signed in cannot set a number',
  case when pg_temp.try(null, $q$ select fn_set_my_contact('08031234567', false) $q$) = '42501'
       then 'PASS' else 'FAIL' end, pg_temp.try(null, $q$ select fn_set_my_contact('08031234567', false) $q$));
insert into t54 values (16, 'an owner cannot see the admin''s list or record a check-in (42501)',
  case when pg_temp.try(pg_temp.u(1), $q$ select fn_admin_checkins_due() $q$) = '42501'
        and pg_temp.try(pg_temp.u(1), $q$ select fn_admin_record_checkin((select acct from fx where k='A'), 'welcome', 'whatsapp', 'reached') $q$) = '42501'
       then 'PASS' else 'FAIL' end, '');

-- ============================================ 4. the admin's list and check-ins
do $$
declare v jsonb; a uuid := (select acct from fx where k = 'A');
begin
  perform set_config('request.jwt.claim.sub', pg_temp.u(9)::text, true);
  perform set_config('role', 'authenticated', true);
  v := fn_admin_checkins_due();
  perform set_config('role', 'postgres', true);
  insert into t54 values (17, 'a two-day-old account is due a welcome, with the owner''s number',
    case when exists (select 1 from jsonb_array_elements(v->'due') d
                       where (d->>'account_id')::uuid = a and d->>'reason' = 'welcome'
                         and d->>'phone' = '2348031234567' and (d->>'phone_confirmed')::boolean = false)
         then 'PASS' else 'FAIL' end, left(v->>'due', 60));
  insert into t54 values (18, 'an owner who gave no number is still listed, with no number',
    case when exists (select 1 from jsonb_array_elements(v->'due') d
                       where (d->>'account_id')::uuid = (select acct from fx where k = 'B')
                         and d->>'reason' = 'welcome' and d->'phone' = 'null'::jsonb)
         then 'PASS' else 'FAIL' end, '');
  insert into t54 values (19, 'and the share of new owners with a number counts them',
    case when (v->>'new_30d_with_phone')::int >= 1 and (v->>'new_30d')::int >= 2 then 'PASS' else 'FAIL' end,
    (v->>'new_30d_with_phone') || ' of ' || (v->>'new_30d'));
end $$;

do $$
declare v jsonb; a uuid := (select acct from fx where k = 'A');
begin
  perform set_config('request.jwt.claim.sub', pg_temp.u(9)::text, true);
  perform set_config('role', 'authenticated', true);
  perform fn_admin_record_checkin(a, 'welcome', 'whatsapp', 'reached', 'Set up fine, costing jollof first');
  v := fn_admin_checkins_due();
  perform set_config('role', 'postgres', true);
  insert into t54 values (20, '"reached" confirms the number',
    case when (select phone_confirmed_at from profiles where id = pg_temp.u(1)) is not null then 'PASS' else 'FAIL' end, '');
  insert into t54 values (21, 'and the welcome is no longer due; the last check-in shows',
    case when not exists (select 1 from jsonb_array_elements(v->'due') d
                           where (d->>'account_id')::uuid = a and d->>'reason' = 'welcome')
          and exists (select 1 from jsonb_array_elements(v->'contacts') c
                       where (c->>'account_id')::uuid = a and c->>'last_kind' = 'welcome' and c->>'last_outcome' = 'reached')
         then 'PASS' else 'FAIL' end, '');
  insert into t54 values (22, 'the check-in records who did it',
    case when (select done_by from admin_checkins where account_id = a) = pg_temp.u(9) then 'PASS' else 'FAIL' end, '');
end $$;

-- a new number unconfirms it
select pg_temp.as_user(pg_temp.u(1), $q$ select fn_set_my_contact('0909 876 5432', false, null, 'account') $q$);
insert into t54 values (23, 'changing the number means it is not confirmed any more',
  case when (select phone from profiles where id = pg_temp.u(1)) = '2349098765432'
        and (select phone_confirmed_at from profiles where id = pg_temp.u(1)) is null
       then 'PASS' else 'FAIL' end, '');

-- opted out: gone, and logged
select pg_temp.as_user(pg_temp.u(1), $q$ select fn_set_my_contact('0909 876 5432', true, null, 'account') $q$);
do $$
declare a uuid := (select acct from fx where k = 'A');
begin
  perform set_config('request.jwt.claim.sub', pg_temp.u(9)::text, true);
  perform set_config('role', 'authenticated', true);
  perform fn_admin_record_checkin(a, 'day3', 'whatsapp', 'opted_out', 'Asked not to be contacted');
  perform set_config('role', 'postgres', true);
  insert into t54 values (24, '"opted out" removes the number and the offers choice',
    case when (select phone from profiles where id = pg_temp.u(1)) is null
          and (select marketing_ok_at from profiles where id = pg_temp.u(1)) is null
         then 'PASS' else 'FAIL' end, '');
  insert into t54 values (25, 'and both withdrawals are logged as the admin''s doing',
    case when (select count(*) from contact_consents where user_id = pg_temp.u(1) and source = 'admin' and not granted) = 2
         then 'PASS' else 'FAIL' end,
    (select count(*)::text from contact_consents where user_id = pg_temp.u(1) and source = 'admin'));
end $$;

insert into t54 values (26, 'a check-in for an account that does not exist is refused (P0002)',
  case when pg_temp.try(pg_temp.u(9), $q$ select fn_admin_record_checkin(gen_random_uuid(), 'other', 'call', 'no_reply') $q$) = 'P0002'
       then 'PASS' else 'FAIL' end, '');
insert into t54 values (27, 'an unknown outcome is refused by the table (23514)',
  case when pg_temp.try(pg_temp.u(9), $q$ select fn_admin_record_checkin((select acct from fx where k='A'), 'other', 'call', 'maybe') $q$) = '23514'
       then 'PASS' else 'FAIL' end, '');

-- ============================================ 5. the review's cases: change, STOP, wrong number, no reply, opt-out
create or replace function pg_temp.admin(p_sql text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.u(9)::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
create or replace function pg_temp.due_for(p_acct uuid) returns text language plpgsql as $$
declare v jsonb; r text;
begin
  perform set_config('request.jwt.claim.sub', pg_temp.u(9)::text, true);
  perform set_config('role', 'authenticated', true);
  v := fn_admin_checkins_due();
  perform set_config('role', 'postgres', true);
  select string_agg(d->>'reason', ',' order by d->>'reason') into r
    from jsonb_array_elements(v->'due') d where (d->>'account_id')::uuid = p_acct;
  return coalesce(r, '');
end $$;

-- B: a number with offers, then a different number
select pg_temp.as_user(pg_temp.u(2), $q$ select fn_set_my_contact('0803 000 0002', true, null, 'account') $q$);
update profiles set marketing_ok_at = now() - interval '30 days' where id = pg_temp.u(2);
select pg_temp.as_user(pg_temp.u(2), $q$ select fn_set_my_contact('0803 000 0003', true, null, 'account') $q$);
insert into t54 values (29, 'a new number with offers ticked restarts the offers consent, and the log names the new number',
  case when (select marketing_ok_at from profiles where id = pg_temp.u(2)) > now() - interval '1 minute'
        and (select count(*) from contact_consents where user_id = pg_temp.u(2) and phone = '2348030000003' and granted) = 2
       then 'PASS' else 'FAIL' end,
  (select count(*)::text from contact_consents where user_id = pg_temp.u(2) and phone = '2348030000003'));

select pg_temp.admin(format($q$ select fn_admin_record_checkin(%L, 'other', 'whatsapp', 'stopped_offers', 'Replied STOP') $q$, (select acct from fx where k = 'B')));
insert into t54 values (30, 'a STOP reply withdraws only the offers: the number stays for help',
  case when (select marketing_ok_at from profiles where id = pg_temp.u(2)) is null
        and (select phone from profiles where id = pg_temp.u(2)) = '2348030000003'
        and exists (select 1 from contact_consents where user_id = pg_temp.u(2) and purpose = 'marketing_whatsapp'
                     and not granted and source = 'admin' and phone = '2348030000003')
       then 'PASS' else 'FAIL' end, '');

select pg_temp.admin(format($q$ select fn_admin_record_checkin(%L, 'other', 'email', 'reached') $q$, (select acct from fx where k = 'B')));
insert into t54 values (31, 'talking to them by email does not confirm their WhatsApp number',
  case when (select phone_confirmed_at from profiles where id = pg_temp.u(2)) is null then 'PASS' else 'FAIL' end, '');

select pg_temp.admin(format($q$ select fn_admin_record_checkin(%L, 'other', 'whatsapp', 'wrong_number', 'A stranger answered') $q$, (select acct from fx where k = 'B')));
insert into t54 values (32, 'a wrong number is removed, flagged for the owner, and the removal logged',
  case when (select phone from profiles where id = pg_temp.u(2)) is null
        and (select phone_wrong_at from profiles where id = pg_temp.u(2)) is not null
        and exists (select 1 from contact_consents where user_id = pg_temp.u(2) and purpose = 'service_contact'
                     and not granted and source = 'admin' and phone = '2348030000003')
       then 'PASS' else 'FAIL' end, '');
do $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub', pg_temp.u(9)::text, true);
  perform set_config('role', 'authenticated', true);
  v := fn_admin_checkins_due();
  perform set_config('role', 'postgres', true);
  insert into t54 values (33, 'and the admin sees "wrong number", with no number to message',
    case when exists (select 1 from jsonb_array_elements(v->'due') d
                       where (d->>'account_id')::uuid = (select acct from fx where k = 'B')
                         and (d->>'phone_wrong')::boolean and d->'phone' = 'null'::jsonb)
         then 'PASS' else 'FAIL' end, '');
end $$;
select pg_temp.as_user(pg_temp.u(2), $q$ select fn_set_my_contact('0803 000 0004', false, null, 'account') $q$);
insert into t54 values (34, 'giving a number again clears the wrong-number flag',
  case when (select phone_wrong_at from profiles where id = pg_temp.u(2)) is null then 'PASS' else 'FAIL' end, '');

-- C: no reply comes back the next day; an opt-out keeps them off until they give a number again
insert into fx
select 'C', (e->>'account_id')::uuid
  from fn_create_account_and_business('T54 C', 'T54 C Kitchen', 'caterer', pg_temp.u(3), p_idempotency_key => 't54-c') e;
select pg_temp.as_user(pg_temp.u(3), $q$ select fn_set_my_contact('0803 000 0005', false, null, 'onboarding') $q$);
select pg_temp.admin(format($q$ select fn_admin_record_checkin(%L, 'welcome', 'whatsapp', 'no_reply') $q$, (select acct from fx where k = 'C')));
insert into t54 values (35, '"no reply" puts the hello aside for today',
  case when pg_temp.due_for((select acct from fx where k = 'C')) = '' then 'PASS' else 'FAIL' end,
  pg_temp.due_for((select acct from fx where k = 'C')));
update admin_checkins set done_at = now() - interval '25 hours' where account_id = (select acct from fx where k = 'C');
insert into t54 values (36, 'and brings it back the next day',
  case when pg_temp.due_for((select acct from fx where k = 'C')) = 'welcome' then 'PASS' else 'FAIL' end,
  pg_temp.due_for((select acct from fx where k = 'C')));

select pg_temp.admin(format($q$ select fn_admin_record_checkin(%L, 'welcome', 'whatsapp', 'opted_out') $q$, (select acct from fx where k = 'C')));
update accounts set created_at = now() - interval '4 days' where id = (select acct from fx where k = 'C');
insert into t54 values (37, 'an owner who asked not to be contacted is not listed on day 3 (or for any reason)',
  case when pg_temp.due_for((select acct from fx where k = 'C')) = '' then 'PASS' else 'FAIL' end,
  pg_temp.due_for((select acct from fx where k = 'C')));
select pg_temp.as_user(pg_temp.u(3), $q$ select fn_set_my_contact('0803 000 0006', false, null, 'account') $q$);
insert into t54 values (38, 'until they give a number again, which says they want to hear from us',
  case when pg_temp.due_for((select acct from fx where k = 'C')) = 'day3' then 'PASS' else 'FAIL' end,
  pg_temp.due_for((select acct from fx where k = 'C')));

-- ============================================ 6. nothing else moved
insert into t54 values (39, '118 policies: 0068 added none',
  case when (select count(*) from pg_policies where schemaname='public') = 118 then 'PASS' else 'FAIL' end,
  (select count(*)::text from pg_policies where schemaname='public'));

select n, check_name, verdict, left(detail, 60) as detail from t54 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t54;

rollback;
