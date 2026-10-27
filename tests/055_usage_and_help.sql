-- ============================================================================
-- MENU MASTER NG -- tests/055_usage_and_help.sql
--
-- Acceptance test for 0069. Run on a database with 0069 applied (with or
-- without 0067). Rolls everything back.
--
-- A person's screen visits, friction, help requests and answers are written
-- only by them, only through the functions, only in checked forms; nobody
-- but a platform admin reads them back; an admin's own use is not recorded;
-- turning recording off stops it and removes what was recorded; raw visits
-- and events go after 90 days.
-- ============================================================================

begin;

create temp table t55 (n int, check_name text, verdict text, detail text) on commit drop;

create or replace function pg_temp.u(n int) returns uuid language sql immutable as
$$ select ('00000055-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.v(n int) returns uuid language sql immutable as
$$ select ('00000055-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid $$;

insert into auth.users (id, email)
select pg_temp.u(n), 'u' || n || '@t55.test' from unnest(array[1, 2, 3, 4, 5, 9]) n;
insert into platform_admins (user_id, reason) values (pg_temp.u(9), 'test 055');

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

-- Runs a jsonb-returning call as p_user and hands back its value.
create or replace function pg_temp.as_user_j(p_user uuid, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into v;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;

create or replace function pg_temp.due(p_user uuid) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
  v := fn_feedback_due();
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return coalesce(v, '');
end $$;

create temp table fx (k text primary key, acct uuid) on commit drop;
insert into fx
select 'A', (e->>'account_id')::uuid
  from fn_create_account_and_business('T55 A', 'T55 A Kitchen', 'caterer', pg_temp.u(1), p_idempotency_key => 't55-a') e
union all
select 'B', (e->>'account_id')::uuid
  from fn_create_account_and_business('T55 B', 'T55 B Kitchen', 'caterer', pg_temp.u(2), p_idempotency_key => 't55-b') e;
-- u3 works in A's kitchen
insert into memberships (account_id, user_id, role) values ((select acct from fx where k = 'A'), pg_temp.u(3), 'kitchen');
-- u4 joins B as a manager, today
insert into memberships (account_id, user_id, role) values ((select acct from fx where k = 'B'), pg_temp.u(4), 'manager');
grant select on fx to authenticated, anon;

-- ============================================ 1. a screen visit, written by its person
select pg_temp.as_user(pg_temp.u(1), format($q$ select fn_usage_beat(%L, %L, 'dashboard', '/dashboard', 'phone', 10, 'active') $q$, pg_temp.v(1), pg_temp.v(100)));
insert into t55 values (1, 'a beat opens a visit for the person, on their account',
  case when (select user_id = pg_temp.u(1) and account_id = (select acct from fx where k = 'A') and active_seconds = 10
                    and screen = 'dashboard' and state = 'active' from usage_views where id = pg_temp.v(1))
       then 'PASS' else 'FAIL' end, '');

select pg_temp.as_user(pg_temp.u(1), format($q$ select fn_usage_beat(%L, %L, 'dashboard', '/dashboard', 'phone', 4, 'active') $q$, pg_temp.v(1), pg_temp.v(100)));
select pg_temp.as_user(pg_temp.u(1), format($q$ select fn_usage_beat(%L, %L, 'dashboard', '/dashboard', 'phone', 50, 'idle') $q$, pg_temp.v(1), pg_temp.v(100)));
insert into t55 values (2, 'the active time only grows, and the state follows the beat',
  case when (select active_seconds = 50 and state = 'idle' from usage_views where id = pg_temp.v(1)) then 'PASS' else 'FAIL' end,
  (select active_seconds || ' ' || state from usage_views where id = pg_temp.v(1)));

select pg_temp.as_user(pg_temp.u(1), format($q$ select fn_usage_beat(%L, %L, 'dashboard', '/dashboard', 'phone', 5000, 'active') $q$, pg_temp.v(1), pg_temp.v(100)));
insert into t55 values (3, 'and never faster than the clock (here: a minute at most)',
  case when (select active_seconds from usage_views where id = pg_temp.v(1)) = 60 then 'PASS' else 'FAIL' end,
  (select active_seconds::text from usage_views where id = pg_temp.v(1)));

select pg_temp.as_user(pg_temp.u(2), format($q$ select fn_usage_beat(%L, %L, 'recipes', '/recipes', 'desktop', 1, 'left') $q$, pg_temp.v(1), pg_temp.v(200)));
insert into t55 values (4, 'someone else''s visit id is ignored, never overwritten or taken over',
  case when (select count(*) from usage_views where id = pg_temp.v(1)) = 1
        and (select user_id = pg_temp.u(1) and state = 'active' and screen = 'dashboard' from usage_views where id = pg_temp.v(1))
        and not exists (select 1 from usage_views where user_id = pg_temp.u(2))
       then 'PASS' else 'FAIL' end, '');

select pg_temp.as_user(pg_temp.u(1), format($q$ select fn_usage_beat(%L, %L, null, '/Recipes?id=3', 'phone', 1, 'active') $q$, pg_temp.v(2), pg_temp.v(100)));
select pg_temp.as_user(pg_temp.u(1), format($q$ select fn_usage_beat(%L, %L, 'Recipes!', '/recipes', 'phone', 1, 'active') $q$, pg_temp.v(3), pg_temp.v(100)));
select pg_temp.as_user(pg_temp.u(1), format($q$ select fn_usage_beat(%L, %L, null, '/recipes', 'fridge', 1, 'active') $q$, pg_temp.v(4), pg_temp.v(100)));
select pg_temp.as_user(pg_temp.u(1), format($q$ select fn_usage_beat(%L, %L, null, '/recipes', 'phone', 1, 'asleep') $q$, pg_temp.v(5), pg_temp.v(100)));
insert into t55 values (5, 'anything that is not a screen pattern, a device or a state is quietly dropped',
  case when not exists (select 1 from usage_views where id in (pg_temp.v(2), pg_temp.v(3), pg_temp.v(4), pg_temp.v(5)))
       then 'PASS' else 'FAIL' end, '');

select pg_temp.as_user(pg_temp.u(9), format($q$ select fn_usage_beat(%L, %L, 'dashboard', '/dashboard', 'desktop', 1, 'active') $q$, pg_temp.v(9), pg_temp.v(900)));
select pg_temp.as_user(pg_temp.u(9), $q$ select fn_usage_event('refusal', 'dashboard', '/dashboard', 'already') $q$);
insert into t55 values (6, 'a platform admin''s own use is not recorded',
  case when not exists (select 1 from usage_views where user_id = pg_temp.u(9))
        and not exists (select 1 from usage_events where user_id = pg_temp.u(9)) then 'PASS' else 'FAIL' end, '');

insert into t55 values (7, 'a visitor who is not signed in cannot send a beat, an event or a request (42501)',
  case when pg_temp.try(null, format($q$ select fn_usage_beat(%L, %L, null, '/', 'phone', 1, 'active') $q$, pg_temp.v(7), pg_temp.v(700))) = '42501'
        and pg_temp.try(null, $q$ select fn_usage_event('crash', null, '/') $q$) = '42501'
        and pg_temp.try(null, $q$ select fn_ask_for_help(null, '/', 'message', 'help') $q$) = '42501'
       then 'PASS' else 'FAIL' end,
  pg_temp.try(null, format($q$ select fn_usage_beat(%L, %L, null, '/', 'phone', 1, 'active') $q$, pg_temp.v(7), pg_temp.v(700))));

-- a stuck loop cannot flood: at most 500 new visits an hour
insert into usage_views (id, session_id, user_id, account_id, path, device)
select gen_random_uuid(), pg_temp.v(300), pg_temp.u(2), (select acct from fx where k = 'B'), '/dashboard', 'phone'
  from generate_series(1, 500);
select pg_temp.as_user(pg_temp.u(2), format($q$ select fn_usage_beat(%L, %L, null, '/dashboard', 'phone', 1, 'active') $q$, pg_temp.v(8), pg_temp.v(300)));
insert into t55 values (8, 'the 501st new visit in an hour is not kept',
  case when not exists (select 1 from usage_views where id = pg_temp.v(8)) then 'PASS' else 'FAIL' end, '');
delete from usage_views where session_id = pg_temp.v(300);

-- ============================================ 2. friction
select pg_temp.as_user(pg_temp.u(1), $q$ select fn_usage_event('refusal', 'recipes', '/recipes/:id', 'already') $q$);
select pg_temp.as_user(pg_temp.u(1), $q$ select fn_usage_event('crash', null, '/recipes/:id', '1234567890') $q$);
select pg_temp.as_user(pg_temp.u(1), $q$ select fn_usage_event('typed', null, '/recipes') $q$);
select pg_temp.as_user(pg_temp.u(1), $q$ select fn_usage_event('refusal', null, '/recipes', 'Egusi soup already exists') $q$);
insert into t55 values (9, 'a refusal and a crash are kept with a short code; a sentence or an unknown kind is not',
  case when (select count(*) from usage_events where user_id = pg_temp.u(1)) = 2
        and exists (select 1 from usage_events where user_id = pg_temp.u(1) and kind = 'refusal' and code = 'already'
                       and account_id = (select acct from fx where k = 'A'))
       then 'PASS' else 'FAIL' end, (select count(*)::text from usage_events where user_id = pg_temp.u(1)));

insert into usage_events (user_id, account_id, kind, path)
select pg_temp.u(2), (select acct from fx where k = 'B'), 'help_open', '/' from generate_series(1, 200);
select pg_temp.as_user(pg_temp.u(2), $q$ select fn_usage_event('crash', null, '/') $q$);
insert into t55 values (10, 'and at most 200 events an hour a person',
  case when (select count(*) from usage_events where user_id = pg_temp.u(2)) = 200 then 'PASS' else 'FAIL' end, '');
delete from usage_events where user_id = pg_temp.u(2);

-- ============================================ 3. no client reads or writes the tables
insert into t55 values (11, 'nobody reads or writes the visits, events, requests or answers directly (42501)',
  case when pg_temp.try(pg_temp.u(1), $q$ select count(*) from usage_views $q$) = '42501'
        and pg_temp.try(pg_temp.u(1), $q$ select count(*) from usage_events $q$) = '42501'
        and pg_temp.try(pg_temp.u(1), $q$ insert into help_requests (user_id, path, channel, message) values (auth.uid(), '/', 'message', 'x') $q$) = '42501'
        and pg_temp.try(pg_temp.u(1), $q$ update feedback set score = 5 $q$) = '42501'
        and pg_temp.try(pg_temp.u(9), $q$ select count(*) from help_requests $q$) = '42501'
        and pg_temp.try(null, $q$ select count(*) from usage_views $q$) = '42501'
       then 'PASS' else 'FAIL' end, pg_temp.try(pg_temp.u(1), $q$ select count(*) from usage_views $q$));

insert into t55 values (12, 'an owner cannot call any admin read or write (42501)',
  case when pg_temp.try(pg_temp.u(1), $q$ select fn_admin_live() $q$) = '42501'
        and pg_temp.try(pg_temp.u(1), $q$ select fn_admin_activation() $q$) = '42501'
        and pg_temp.try(pg_temp.u(1), $q$ select fn_admin_journey((select acct from fx where k = 'A')) $q$) = '42501'
        and pg_temp.try(pg_temp.u(1), $q$ select fn_admin_help() $q$) = '42501'
        and pg_temp.try(pg_temp.u(1), $q$ select fn_admin_set_help_status(1, 'resolved') $q$) = '42501'
        and pg_temp.try(pg_temp.u(1), $q$ select fn_usage_purge() $q$) = '42501'
       then 'PASS' else 'FAIL' end, pg_temp.try(pg_temp.u(1), $q$ select fn_usage_purge() $q$));

-- ============================================ 4. help from inside the app
insert into t55 values (13, 'writing to us needs words (22023); an unknown way to ask is refused',
  case when pg_temp.try(pg_temp.u(1), $q$ select fn_ask_for_help('recipes', '/recipes', 'message', '   ') $q$) = '22023'
        and pg_temp.try(pg_temp.u(1), $q$ select fn_ask_for_help('recipes', '/recipes', 'sms', 'hi') $q$) = '22023'
       then 'PASS' else 'FAIL' end, '');

create temp table h (k text primary key, r jsonb) on commit drop;
insert into h select 'msg', pg_temp.as_user_j(pg_temp.u(1), $q$ select fn_ask_for_help('recipes', '/recipes/:id', 'message', '  How do I add a pack size?  ', 'phone') $q$);
insert into h select 'wa', pg_temp.as_user_j(pg_temp.u(1), $q$ select fn_ask_for_help(null, '/odd?path', 'whatsapp', null, 'fridge') $q$);
insert into t55 values (14, 'a request comes back with its reference, kept with the screen and the account',
  case when (select r->>'ref' = 'H' || (r->>'id') from h where k = 'msg')
        and (select message = 'How do I add a pack size?' and screen = 'recipes' and path = '/recipes/:id' and device = 'phone'
                    and status = 'open' and account_id = (select acct from fx where k = 'A')
               from help_requests where id = (select (r->>'id')::bigint from h where k = 'msg'))
       then 'PASS' else 'FAIL' end, (select r::text from h where k = 'msg'));
insert into t55 values (15, 'opening WhatsApp needs no words; a path or device that is not one is stored as nothing',
  case when (select path = '/' and device is null and message is null and channel = 'whatsapp'
               from help_requests where id = (select (r->>'id')::bigint from h where k = 'wa'))
       then 'PASS' else 'FAIL' end, '');

insert into help_requests (user_id, account_id, path, channel, message)
select pg_temp.u(2), (select acct from fx where k = 'B'), '/', 'message', 'again' from generate_series(1, 10);
insert into t55 values (16, 'ten requests a day is enough: the eleventh is refused, politely (22023)',
  case when pg_temp.try(pg_temp.u(2), $q$ select fn_ask_for_help(null, '/', 'message', 'one more') $q$) = '22023'
       then 'PASS' else 'FAIL' end, '');
delete from help_requests where user_id = pg_temp.u(2);

-- ============================================ 5. the short questions
insert into t55 values (17, 'nobody is asked on their first day',
  case when pg_temp.due(pg_temp.u(1)) = '' then 'PASS' else 'FAIL' end, pg_temp.due(pg_temp.u(1)));

update accounts set created_at = now() - interval '40 days' where id in (select acct from fx);
update memberships set created_at = now() - interval '40 days' where user_id in (pg_temp.u(1), pg_temp.u(2), pg_temp.u(3));
insert into usage_views (id, session_id, user_id, account_id, path, device, started_at, last_seen_at)
select gen_random_uuid(), pg_temp.v(400), pg_temp.u(n), (select acct from fx where k = case when n = 1 then 'A' when n = 2 then 'B' else 'A' end),
       '/dashboard', 'phone', now() - (d || ' days')::interval, now() - (d || ' days')::interval
  from unnest(array[1, 2, 3]) n, generate_series(1, 12) d;
insert into usage_views (id, session_id, user_id, account_id, path, device, started_at, last_seen_at)
select gen_random_uuid(), pg_temp.v(401), pg_temp.u(4), (select acct from fx where k = 'B'),
       '/dashboard', 'phone', now() - (d || ' days')::interval, now() - (d || ' days')::interval
  from generate_series(1, 12) d;
insert into t55 values (18, 'after a month of real use the owner is asked whether they would recommend us',
  case when pg_temp.due(pg_temp.u(1)) = 'nps' then 'PASS' else 'FAIL' end, pg_temp.due(pg_temp.u(1)));
insert into t55 values (19, 'but the kitchen staff are never asked',
  case when pg_temp.due(pg_temp.u(3)) = '' then 'PASS' else 'FAIL' end, pg_temp.due(pg_temp.u(3)));
insert into t55 values (20, 'nor is an admin',
  case when pg_temp.due(pg_temp.u(9)) = '' then 'PASS' else 'FAIL' end, '');
insert into t55 values (40, 'a manager is not asked on their own first day, however old the business',
  case when pg_temp.due(pg_temp.u(4)) = '' then 'PASS' else 'FAIL' end, pg_temp.due(pg_temp.u(4)));
update memberships set created_at = now() - interval '40 days' where user_id = pg_temp.u(4);
insert into t55 values (41, 'and is asked the recommend question once they have been there a month',
  case when pg_temp.due(pg_temp.u(4)) = 'nps' then 'PASS' else 'FAIL' end, pg_temp.due(pg_temp.u(4)));

select pg_temp.as_user(pg_temp.u(1), $q$ select fn_give_feedback('nps', 4, '  Too many steps to cost a dish  ', 'dashboard') $q$);
select pg_temp.as_user(pg_temp.u(1), $q$ select fn_give_feedback('nps', 10, null, 'dashboard') $q$);
insert into t55 values (21, 'one answer per question per day, kept with the account; a second is ignored',
  case when (select count(*) from feedback where user_id = pg_temp.u(1)) = 1
        and (select score = 4 and comment = 'Too many steps to cost a dish' and account_id = (select acct from fx where k = 'A')
               from feedback where user_id = pg_temp.u(1))
       then 'PASS' else 'FAIL' end, '');
insert into t55 values (22, 'and then nothing more is asked for a fortnight',
  case when pg_temp.due(pg_temp.u(1)) = '' then 'PASS' else 'FAIL' end, pg_temp.due(pg_temp.u(1)));

select pg_temp.as_user(pg_temp.u(2), $q$ select fn_give_feedback('nps', null) $q$);
insert into t55 values (23, '"Not now" is recorded as asked, with no score',
  case when (select score is null from feedback where user_id = pg_temp.u(2)) and pg_temp.due(pg_temp.u(2)) = ''
       then 'PASS' else 'FAIL' end, '');
insert into t55 values (24, 'a score off the scale or an unknown question is refused',
  case when pg_temp.try(pg_temp.u(3), $q$ select fn_give_feedback('nps', 11) $q$) = '22023'
        and pg_temp.try(pg_temp.u(3), $q$ select fn_give_feedback('first_dish', 0) $q$) = '22023'
        and pg_temp.try(pg_temp.u(3), $q$ select fn_give_feedback('mood', 3) $q$) = '22023'
       then 'PASS' else 'FAIL' end, pg_temp.try(pg_temp.u(3), $q$ select fn_give_feedback('nps', 11) $q$));

select pg_temp.as_user(pg_temp.u(3), $q$ select fn_give_feedback('nps', 10) $q$);
select pg_temp.as_user(pg_temp.u(1), $q$ select fn_give_feedback('first_dish', 5) $q$);
insert into t55 values (47, 'an answer nobody asked for is not kept: staff, or a question not due',
  case when not exists (select 1 from feedback where user_id = pg_temp.u(3))
        and not exists (select 1 from feedback where user_id = pg_temp.u(1) and prompt = 'first_dish')
       then 'PASS' else 'FAIL' end, '');

-- ============================================ 6. what the admin sees
select pg_temp.as_user(pg_temp.u(1), format($q$ select fn_usage_beat(%L, %L, 'dashboard', '/dashboard', 'phone', 30, 'left') $q$, pg_temp.v(1), pg_temp.v(100)));
select pg_temp.as_user(pg_temp.u(1), format($q$ select fn_usage_beat(%L, %L, 'recipes', '/recipes/:id', 'phone', 0, 'active') $q$, pg_temp.v(10), pg_temp.v(100)));
-- a minute beat for the screen she left, arriving late
select pg_temp.as_user(pg_temp.u(1), format($q$ select fn_usage_beat(%L, %L, 'dashboard', '/dashboard', 'phone', 40, 'active') $q$, pg_temp.v(1), pg_temp.v(100)));
insert into t55 values (42, 'a late beat for a screen she left does not reopen it',
  case when (select state from usage_views where id = pg_temp.v(1)) = 'left'
        and (select count(*) from usage_views where id = pg_temp.v(1)) = 1 then 'PASS' else 'FAIL' end,
  (select state from usage_views where id = pg_temp.v(1)));
do $$
declare v jsonb; me jsonb;
begin
  perform set_config('request.jwt.claim.sub', pg_temp.u(9)::text, true);
  perform set_config('role', 'authenticated', true);
  v := fn_admin_live();
  perform set_config('role', 'postgres', true);
  select r into me from jsonb_array_elements(v->'rows') r where (r->>'user_id')::uuid = pg_temp.u(1);
  insert into t55 values (25, 'Live now shows the owner on the screen they just opened, not the one they left',
    case when me->>'screen' = 'recipes' and (me->>'live')::boolean and me->>'business' = 'T55 A'
              and me->>'email' = 'u1@t55.test' and (v->>'live')::int >= 1
         then 'PASS' else 'FAIL' end, left(coalesce(me::text, v::text), 60));
  insert into t55 values (26, 'and counts the people on each screen this minute',
    case when exists (select 1 from jsonb_array_elements(v->'by_screen') s where s->>'path' = '/recipes/:id' and (s->>'n')::int >= 1)
         then 'PASS' else 'FAIL' end, left(v->>'by_screen', 60));
end $$;

do $$
declare v jsonb; a jsonb; acct uuid := (select acct from fx where k = 'A');
begin
  perform set_config('request.jwt.claim.sub', pg_temp.u(9)::text, true);
  perform set_config('role', 'authenticated', true);
  v := fn_admin_activation();
  select r into a from jsonb_array_elements(v) r where (r->>'id')::uuid = acct;
  perform set_config('role', 'postgres', true);
  insert into t55 values (27, 'Journeys has each account''s steps and signals: business, help waiting, refusals, last rating',
    case when a->>'business_at' is not null and a->'purchase_at' = 'null'::jsonb
              and (a->>'open_help')::int = 2 and (a->>'refusals_24h')::int = 1
              and (a->>'low_score')::int = 4 and a->>'low_prompt' = 'nps' and a->>'email' = 'u1@t55.test'
              and (a->>'active_days_14')::int between 10 and 14
              and a->>'low_score_at' is not null and a->'last_checkin_at' = 'null'::jsonb
         then 'PASS' else 'FAIL' end, left(coalesce(a::text, 'no row'), 60));
  perform set_config('role', 'authenticated', true);
  v := fn_admin_activation(acct);
  perform set_config('role', 'postgres', true);
  insert into t55 values (43, 'and one account''s row alone, for its journey page',
    case when jsonb_array_length(v) = 1 and (v->0->>'id')::uuid = acct then 'PASS' else 'FAIL' end, left(v::text, 60));
end $$;

do $$
declare v jsonb; acct uuid := (select acct from fx where k = 'A');
begin
  perform set_config('request.jwt.claim.sub', pg_temp.u(9)::text, true);
  perform set_config('role', 'authenticated', true);
  v := fn_admin_journey(acct);
  perform set_config('role', 'postgres', true);
  insert into t55 values (28, 'one owner''s journey: people, visits, friction, help and answers',
    case when jsonb_array_length(v->'members') = 2 and jsonb_array_length(v->'visits') >= 12
              and jsonb_array_length(v->'events') = 2 and jsonb_array_length(v->'help') = 2
              and jsonb_array_length(v->'feedback') = 1 and v->'account'->>'name' = 'T55 A'
         then 'PASS' else 'FAIL' end, left(v::text, 60));
  perform set_config('role', 'authenticated', true);
  v := fn_admin_journey(gen_random_uuid());
  perform set_config('role', 'postgres', true);
  insert into t55 values (29, 'and no journey for an account that does not exist',
    case when v is null then 'PASS' else 'FAIL' end, coalesce(v::text, 'null'));
end $$;

-- a check-in that did not reach her does not answer her low rating; one that did, does
create or replace function pg_temp.checkin_at() returns text language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub', pg_temp.u(9)::text, true);
  perform set_config('role', 'authenticated', true);
  v := fn_admin_activation((select acct from fx where k = 'A'));
  perform set_config('role', 'postgres', true);
  return coalesce(v->0->>'last_checkin_at', '');
end $$;
select pg_temp.as_user(pg_temp.u(9), format($q$ select fn_admin_record_checkin(%L, 'other', 'whatsapp', 'no_reply') $q$, (select acct from fx where k = 'A')));
insert into t55 values (48, 'a check-in with no reply does not count as having reached her',
  case when pg_temp.checkin_at() = '' then 'PASS' else 'FAIL' end, pg_temp.checkin_at());
select pg_temp.as_user(pg_temp.u(9), format($q$ select fn_admin_record_checkin(%L, 'other', 'email', 'reached') $q$, (select acct from fx where k = 'A')));
insert into t55 values (49, 'one that reached her does',
  case when pg_temp.checkin_at() <> '' then 'PASS' else 'FAIL' end, pg_temp.checkin_at());

select pg_temp.as_user(pg_temp.u(9), format($q$ select fn_admin_set_help_status(%s, 'replied', 'Sent the pack size video') $q$, (select r->>'id' from h where k = 'msg')));
insert into t55 values (30, 'the admin marks a request replied, with a note, and who and when',
  case when (select status = 'replied' and handled_by = pg_temp.u(9) and handled_at is not null and note = 'Sent the pack size video'
               from help_requests where id = (select (r->>'id')::bigint from h where k = 'msg'))
       then 'PASS' else 'FAIL' end, '');
select pg_temp.as_user(pg_temp.u(9), format($q$ select fn_admin_set_help_status(%s, 'open') $q$, (select r->>'id' from h where k = 'msg')));
insert into t55 values (31, 'opening it again clears who handled it and keeps the note',
  case when (select status = 'open' and handled_by is null and handled_at is null and note = 'Sent the pack size video'
               from help_requests where id = (select (r->>'id')::bigint from h where k = 'msg'))
       then 'PASS' else 'FAIL' end, '');
insert into t55 values (32, 'an unknown status (22023) or request (P0002) is refused',
  case when pg_temp.try(pg_temp.u(9), $q$ select fn_admin_set_help_status(1, 'closed') $q$) = '22023'
        and pg_temp.try(pg_temp.u(9), $q$ select fn_admin_set_help_status(-1, 'resolved') $q$) = 'P0002'
       then 'PASS' else 'FAIL' end, '');
select pg_temp.as_user(pg_temp.u(9), format($q$ select fn_admin_set_help_status(%s, 'open', '  ') $q$, (select r->>'id' from h where k = 'msg')));
insert into t55 values (44, 'an emptied note box clears the note',
  case when (select note is null from help_requests where id = (select (r->>'id')::bigint from h where k = 'msg'))
       then 'PASS' else 'FAIL' end, '');

do $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub', pg_temp.u(9)::text, true);
  perform set_config('role', 'authenticated', true);
  v := fn_admin_help();
  perform set_config('role', 'postgres', true);
  insert into t55 values (33, 'Help & feedback lists the requests, the answers and where people were refused',
    case when exists (select 1 from jsonb_array_elements(v->'requests') r where r->>'email' = 'u1@t55.test' and r->>'business' = 'T55 A')
              and exists (select 1 from jsonb_array_elements(v->'feedback') f where f->>'email' = 'u1@t55.test' and (f->>'score')::int = 4)
              and exists (select 1 from jsonb_array_elements(v->'refusals') x where x->>'path' = '/recipes/:id' and (x->>'people')::int = 1)
         then 'PASS' else 'FAIL' end, left(v::text, 60));
  insert into t55 values (45, 'every open request is counted, and the rating figures come from every answer',
    case when (v->>'open_count')::int = 2
              and (v->'scores'->>'asked')::int = 2 and (v->'scores'->>'answered')::int = 1
              and v->'scores'->'nps' = '[4]'::jsonb and v->'scores'->'ease' = '[]'::jsonb
         then 'PASS' else 'FAIL' end, left(v->>'scores', 60));
end $$;

-- ============================================ 7. turning it off, and the 90 days
select pg_temp.as_user(pg_temp.u(1), $q$ select fn_set_my_usage_tracking(false) $q$);
select pg_temp.as_user(pg_temp.u(1), format($q$ select fn_usage_beat(%L, %L, 'dashboard', '/dashboard', 'phone', 1, 'active') $q$, pg_temp.v(11), pg_temp.v(100)));
select pg_temp.as_user(pg_temp.u(1), $q$ select fn_usage_event('refusal', null, '/recipes', 'already') $q$);
insert into t55 values (34, 'turning recording off removes what was recorded and records no more',
  case when (select usage_opt_out_at is not null from profiles where id = pg_temp.u(1))
        and not exists (select 1 from usage_views where user_id = pg_temp.u(1))
        and not exists (select 1 from usage_events where user_id = pg_temp.u(1))
       then 'PASS' else 'FAIL' end, '');
insert into t55 values (35, 'but keeps what they chose to send: help requests and answers',
  case when (select count(*) from help_requests where user_id = pg_temp.u(1)) = 2
        and (select count(*) from feedback where user_id = pg_temp.u(1)) = 1
       then 'PASS' else 'FAIL' end, '');
select pg_temp.as_user(pg_temp.u(1), $q$ select fn_set_my_usage_tracking(true) $q$);
select pg_temp.as_user(pg_temp.u(1), format($q$ select fn_usage_beat(%L, %L, 'dashboard', '/dashboard', 'phone', 1, 'active') $q$, pg_temp.v(12), pg_temp.v(100)));
insert into t55 values (36, 'and turning it on again records again',
  case when (select usage_opt_out_at is null from profiles where id = pg_temp.u(1))
        and exists (select 1 from usage_views where id = pg_temp.v(12)) then 'PASS' else 'FAIL' end, '');
insert into t55 values (37, 'a visitor who is not signed in cannot change it (42501)',
  case when pg_temp.try(null, $q$ select fn_set_my_usage_tracking(false) $q$) = '42501' then 'PASS' else 'FAIL' end, '');

update usage_views set started_at = now() - interval '91 days' where id = pg_temp.v(12);
insert into usage_events (user_id, account_id, kind, path, at)
values (pg_temp.u(3), (select acct from fx where k = 'A'), 'crash', '/', now() - interval '91 days'),
       (pg_temp.u(3), (select acct from fx where k = 'A'), 'crash', '/', now() - interval '89 days');
do $$
declare v jsonb;
begin
  v := fn_usage_purge();
  insert into t55 values (38, 'the nightly purge removes visits and events older than 90 days, and only those',
    case when not exists (select 1 from usage_views where id = pg_temp.v(12))
              and exists (select 1 from usage_views where user_id = pg_temp.u(2))
              and (select count(*) from usage_events where user_id = pg_temp.u(3)) = 1
              and (v->>'views')::int >= 1 and (v->>'events')::int >= 1
         then 'PASS' else 'FAIL' end, v::text);
end $$;

-- ============================================ 7b. before the business existed, and "today"
-- u5 signs up: a screen and a help request on onboarding, before any business
select pg_temp.as_user(pg_temp.u(5), format($q$ select fn_usage_beat(%L, %L, 'onboarding', '/onboarding', 'phone', 5, 'active') $q$, pg_temp.v(50), pg_temp.v(500)));
select pg_temp.as_user_j(pg_temp.u(5), $q$ select fn_ask_for_help('onboarding', '/onboarding', 'message', 'What is a business type?') $q$);
insert into fx select 'E', (e->>'account_id')::uuid
  from fn_create_account_and_business('T55 E', 'T55 E Kitchen', 'caterer', pg_temp.u(5), p_idempotency_key => 't55-e') e;
select pg_temp.as_user(pg_temp.u(5), format($q$ select fn_usage_beat(%L, %L, 'start', '/start/purchase', 'phone', 0, 'active') $q$, pg_temp.v(51), pg_temp.v(500)));
insert into t55 values (50, 'what she did before her business existed joins it once it does',
  case when (select account_id from usage_views where id = pg_temp.v(50)) = (select acct from fx where k = 'E')
        and (select account_id from help_requests where user_id = pg_temp.u(5)) = (select acct from fx where k = 'E')
       then 'PASS' else 'FAIL' end, '');

create or replace function pg_temp.today() returns int language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub', pg_temp.u(9)::text, true);
  perform set_config('role', 'authenticated', true);
  v := fn_admin_live();
  perform set_config('role', 'postgres', true);
  return (v->>'today')::int;
end $$;
create temp table t55_today on commit drop as select pg_temp.today() as n;
-- u4 opened a screen a minute before Lagos midnight and is on it now
insert into usage_views (id, session_id, user_id, account_id, path, device, started_at, last_seen_at)
values (pg_temp.v(52), pg_temp.v(401), pg_temp.u(4), (select acct from fx where k = 'B'), '/sales', 'desktop',
        greatest(((now() at time zone 'Africa/Lagos')::date::timestamp at time zone 'Africa/Lagos') - interval '1 minute',
                 now() - interval '23 hours'), now());
insert into t55 values (51, '"today" counts someone whose visit began before midnight and who is here now',
  case when pg_temp.today() = (select n from t55_today) + 1 then 'PASS' else 'FAIL' end,
  (select n from t55_today)::text || ' -> ' || pg_temp.today()::text);

-- ============================================ 8. the first-step indexes, and nothing else moved
insert into t55 values (46, 'each account''s first purchase, dish, price, sale and payment is one index entry',
  case when (select count(*) from pg_indexes where schemaname = 'public'
              and indexname in ('purchases_first_posted_idx','cost_snapshots_first_complete_idx','recipe_prices_account_created_idx',
                                'orders_first_final_idx','sales_entries_account_created_idx','billing_events_first_paid_idx')) = 6
       then 'PASS' else 'FAIL' end, '');
insert into t55 values (39, '118 policies: 0069 added none',
  case when (select count(*) from pg_policies where schemaname='public') = 118 then 'PASS' else 'FAIL' end,
  (select count(*)::text from pg_policies where schemaname='public'));

select n, check_name, verdict, left(detail, 60) as detail from t55 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t55;

rollback;
