-- ============================================================================
-- MENU MASTER NG
-- 0069: see how owners use the app -- who is in it now and on which screen,
--       how far each has got, where they get stuck, when they ask for help,
--       and whether it is working for them
--
-- Requires: 0001-0066 and 0068 (signup contact) applied. Independent of 0067:
-- it may go in before or after it (0067's count checks allow for the
-- functions added here).
--
-- WHY
--   The owner: "we just know users are signing up; we can't tell are they
--   happy or even able to use the platform, which screen they are live at,
--   how many, who is live and which page." Nothing first-party recorded app
--   use: the analytics events go only to ad pixels, after cookie consent, and
--   none are configured on production. Research of 26 Oct 2026 (GA4 and
--   Plausible realtime windows, Intercom/PostHog person timelines, Fullstory
--   frustration signals, Refiner/Sprig survey timing; NDPA 2023 ss.25, 27, 36)
--   set the shape.
--
-- WHAT THIS ADDS
--   usage_views        one row per screen visit: who, which business, which
--                      screen (a route pattern like /recipes/:id -- never ids,
--                      amounts, names or anything typed), device class, when
--                      it started, the last beat, active seconds, state.
--                      fillfactor 80 and no index on the beat columns, so the
--                      minute-by-minute updates stay HOT.
--   usage_events       friction worth knowing: a refusal shown, a help video
--                      opened, the Help sheet opened, a crash. A short code at
--                      most, never the message text.
--   help_requests      "Need help?" from inside the app, with the screen it
--                      came from; the admin marks it replied or resolved.
--   feedback           short ratings: "how easy was that?" after the first
--                      costed dish and the first sale (1-5), and "would you
--                      recommend us?" after a month of use (0-10). A dismissal
--                      is a row with no score, so nobody is asked twice.
--   profiles.usage_opt_out_at
--                      the owner objected to their screens being recorded
--                      (NDPA s.36); recording stops for them.
--   fn_usage_beat, fn_usage_event, fn_ask_for_help, fn_give_feedback,
--   fn_feedback_due, fn_set_my_usage_tracking     the app's calls
--   fn_admin_live, fn_admin_activation, fn_admin_journey, fn_admin_help,
--   fn_admin_set_help_status                       the admin's reads/writes
--   fn_usage_purge                                 raw visits and events older
--                                                  than 90 days go, nightly
--
-- ACCESS
--   Every table: RLS on, no policy, no client grant. People write only their
--   OWN rows, through the functions above, as auth.uid(); nobody but a
--   platform administrator reads anything back. Platform administrators'
--   own use of the app is not recorded.
--
-- ALSO
--   Six partial indexes on existing tables (purchases, cost_snapshots,
--   recipe_prices, orders, sales_entries, billing_events), each (account_id,
--   when), so "an account's first purchase / costed dish / price / sale /
--   payment" is one index entry, not every row the account has.
--
-- WHAT DOES NOT CHANGE
--   No policy (118). fn_* +12. No existing row.
-- ============================================================================

drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0069 ABORT: this executor is not honouring transaction control '
      '(each statement is committing on its own). Run it with '
      'psql --single-transaction over the Session Pooler.';
  end if;
end
$guard$;
drop table _tx_probe;

create temp table _mm0069_before on commit drop as
select (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') as fns,
       (select count(*) from pg_policies where schemaname='public') as pols;

-- ---------------------------------------------------------------------------
-- 1. PREFLIGHT
-- ---------------------------------------------------------------------------
do $$
declare v_fns int; v_pols int;
begin
  if to_regprocedure('public.fn_require_entitled(uuid, boolean)') is null then
    raise exception '0069 preflight FAILED: fn_require_entitled is missing. Apply 0066_trial_gate first.';
  end if;
  if to_regclass('public.contact_consents') is null
     or to_regprocedure('public.fn_set_my_contact(text, boolean, text, text)') is null then
    raise exception '0069 preflight FAILED: 0068 (signup contact) is not applied. Apply 0068 first.';
  end if;
  if to_regclass('public.usage_views') is not null or to_regclass('public.help_requests') is not null
     or exists (select 1 from pg_proc where pronamespace='public'::regnamespace
                 and proname in ('fn_usage_beat','fn_usage_event','fn_ask_for_help','fn_give_feedback',
                                 'fn_feedback_due','fn_set_my_usage_tracking','fn_admin_live',
                                 'fn_admin_activation','fn_admin_journey','fn_admin_help',
                                 'fn_admin_set_help_status','fn_usage_purge')) then
    raise exception '0069 preflight FAILED: 0069 is already applied.';
  end if;

  if coalesce(current_setting('mm.fresh_install', true), '') = 'on' then
    raise notice '0069 preflight: fresh install, production baseline counts skipped.';
    return;
  end if;
  select fns, pols into v_fns, v_pols from _mm0069_before;
  if v_pols <> 118 then
    raise exception '0069 preflight FAILED: policy count is %, expected 118.', v_pols;
  end if;
  -- 106 with 0066 and 0068; 111 once 0067 is in as well.
  if v_fns not in (106, 111) then
    raise exception '0069 preflight FAILED: fn_* count is %, expected 106 (0066, 0068) or 111 (and 0067).', v_fns;
  end if;
  raise notice '0069 preflight OK: 118 policies, % fn_*.', v_fns;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. TABLES
-- ---------------------------------------------------------------------------
alter table profiles add column usage_opt_out_at timestamptz;
comment on column profiles.usage_opt_out_at is
  'When the person asked us not to record which screens they open (NDPA s.36). Null: recorded.';

-- The route pattern and screen key the app sends: lower-case, no ids, no query.
create table usage_views (
  id             uuid primary key,                         -- made in the browser, one per screen visit
  session_id     uuid not null,                            -- one per page load, never stored on the phone
  user_id        uuid not null references auth.users(id) on delete cascade,
  account_id     uuid references accounts(id) on delete cascade,
  screen         text check (screen is null or screen ~ '^[a-z0-9-]{1,40}$'),
  path           text not null check (path ~ '^/[a-z0-9/_:-]{0,99}$'),
  device         text not null check (device in ('phone', 'tablet', 'desktop')),
  started_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  active_seconds integer not null default 0 check (active_seconds between 0 and 86400),
  state          text not null default 'active' check (state in ('active', 'idle', 'hidden', 'left'))
) with (fillfactor = 80);
create index usage_views_started_idx on usage_views (started_at);
create index usage_views_user_idx on usage_views (user_id, started_at desc);
create index usage_views_account_idx on usage_views (account_id, started_at desc);
-- a visit made before she had a business (onboarding), to attach once it exists
create index usage_views_unattached_idx on usage_views (user_id) where account_id is null;
alter table usage_views enable row level security;
revoke all on usage_views from anon, authenticated;
comment on table usage_views is
  'One row per screen visit by a signed-in person: which screen (a route pattern, '
  'never ids or anything typed), when, how long active. Written only by '
  'fn_usage_beat as the person themselves; read only by platform administrators. '
  'Kept 90 days (fn_usage_purge).';

create table usage_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  account_id  uuid references accounts(id) on delete cascade,
  kind        text not null check (kind in ('refusal', 'help_open', 'help_video', 'crash')),
  screen      text check (screen is null or screen ~ '^[a-z0-9-]{1,40}$'),
  path        text not null check (path ~ '^/[a-z0-9/_:-]{0,99}$'),
  code        text check (code is null or code ~ '^[A-Za-z0-9_]{1,24}$'),
  at          timestamptz not null default now()
);
create index usage_events_user_idx on usage_events (user_id, at desc);
create index usage_events_account_idx on usage_events (account_id, at desc);
create index usage_events_at_idx on usage_events (at);
create index usage_events_unattached_idx on usage_events (user_id) where account_id is null;
alter table usage_events enable row level security;
revoke all on usage_events from anon, authenticated;
comment on table usage_events is
  'Friction worth knowing about: a refusal shown, the Help sheet or a help video '
  'opened, a crash. A short code at most, never the message. Kept 90 days.';

create table help_requests (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  account_id  uuid references accounts(id) on delete cascade,
  screen      text check (screen is null or screen ~ '^[a-z0-9-]{1,40}$'),
  path        text not null check (path ~ '^/[a-z0-9/_:-]{0,99}$'),
  channel     text not null check (channel in ('message', 'whatsapp')),
  message     text check (message is null or length(message) between 1 and 1000),
  device      text check (device is null or device in ('phone', 'tablet', 'desktop')),
  status      text not null default 'open' check (status in ('open', 'replied', 'resolved')),
  handled_by  uuid references auth.users(id) on delete set null,
  handled_at  timestamptz,
  note        text check (note is null or length(note) <= 500),
  created_at  timestamptz not null default now(),
  check (channel = 'whatsapp' or message is not null)
);
create index help_requests_user_idx on help_requests (user_id, created_at desc);
create index help_requests_account_idx on help_requests (account_id, created_at desc);
create index help_requests_handled_by_idx on help_requests (handled_by);
create index help_requests_open_idx on help_requests (created_at) where status = 'open';
create index help_requests_unattached_idx on help_requests (user_id) where account_id is null;
alter table help_requests enable row level security;
revoke all on help_requests from anon, authenticated;
comment on table help_requests is
  'Requests for help sent from inside the app, with the screen they came from. '
  'Written by fn_ask_for_help; handled by a platform administrator.';

create table feedback (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  account_id  uuid references accounts(id) on delete cascade,
  prompt      text not null check (prompt in ('first_dish', 'first_sale', 'nps')),
  score       smallint,                                     -- null: asked and dismissed
  comment     text check (comment is null or length(comment) between 1 and 500),
  screen      text check (screen is null or screen ~ '^[a-z0-9-]{1,40}$'),
  created_at  timestamptz not null default now(),
  check (score is null
         or (prompt in ('first_dish', 'first_sale') and score between 1 and 5)
         or (prompt = 'nps' and score between 0 and 10))
);
create index feedback_user_idx on feedback (user_id, created_at desc);
create index feedback_account_idx on feedback (account_id, created_at desc);
alter table feedback enable row level security;
revoke all on feedback from anon, authenticated;
comment on table feedback is
  'Short ratings from inside the app. A row with no score is a dismissal, so the '
  'same question is not asked again. Read only by platform administrators.';

-- Each account's first step of each kind, for fn_admin_activation: min(when)
-- over (account_id, when) is one index entry. The predicates match the reads.
create index purchases_first_posted_idx on purchases (account_id, posted_at)
  where posted_at is not null and reverses is null;
create index cost_snapshots_first_complete_idx on cost_snapshots (account_id, computed_at) where is_complete;
create index recipe_prices_account_created_idx on recipe_prices (account_id, created_at);
create index orders_first_final_idx on orders (account_id, finalised_at)
  where finalised_at is not null and voided_at is null;
create index sales_entries_account_created_idx on sales_entries (account_id, created_at) where voided_at is null;
create index billing_events_first_paid_idx on billing_events (account_id, received_at)
  where event_type = 'charge.success' and status = 'applied';

-- ---------------------------------------------------------------------------
-- 3. THE APP'S CALLS (all as the signed-in person; none reads anything back)
-- ---------------------------------------------------------------------------

-- The business a person works in: their oldest membership, as the app shows it.
-- (Inlined in each function rather than a new fn_*, to keep the surface small.)

create or replace function fn_usage_beat(
  p_id uuid, p_session uuid, p_screen text, p_path text, p_device text, p_active integer, p_state text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_uid uuid := auth.uid(); v_acct uuid;
begin
  -- Quietly nothing for: nobody signed in, an administrator, someone who
  -- objected, or anything that is not a screen pattern. A beat never errors
  -- at the person: it is not their business.
  if v_uid is null or p_id is null or p_session is null then return; end if;
  if fn_is_platform_admin() then return; end if;
  -- One of this person's writes at a time, with fn_set_my_usage_tracking: a
  -- beat that arrives while recording is being turned off waits, then sees it.
  perform pg_advisory_xact_lock(hashtextextended('mm-usage:' || v_uid::text, 0));
  if exists (select 1 from profiles where id = v_uid and usage_opt_out_at is not null) then return; end if;
  if p_path is null or p_path !~ '^/[a-z0-9/_:-]{0,99}$'
     or (p_screen is not null and p_screen !~ '^[a-z0-9-]{1,40}$')
     or p_device not in ('phone', 'tablet', 'desktop')
     or p_state not in ('active', 'idle', 'hidden', 'left') then
    return;
  end if;

  update usage_views
     set last_seen_at   = now(),
         -- the browser sends the visit's running total; it can only grow,
         -- and never faster than the clock
         active_seconds = greatest(active_seconds,
                                   least(coalesce(p_active, 0), 86400,
                                         extract(epoch from now() - started_at)::int + 60)),
         state          = p_state
   -- a visit closed by moving on stays closed: a late minute beat that lands
   -- after the close finds nothing to update, and the insert below ignores it
   where id = p_id and user_id = v_uid and state <> 'left';
  if found then return; end if;

  -- A new visit: at most 500 an hour per person, so a stuck loop cannot flood.
  if (select count(*) from usage_views where user_id = v_uid and started_at > now() - interval '1 hour') >= 500 then
    return;
  end if;
  select m.account_id into v_acct from memberships m where m.user_id = v_uid order by m.created_at limit 1;
  insert into usage_views (id, session_id, user_id, account_id, screen, path, device, active_seconds, state)
  values (p_id, p_session, v_uid, v_acct, p_screen, p_path, p_device, least(greatest(coalesce(p_active, 0), 0), 60), p_state)
  on conflict (id) do nothing;      -- someone else's id: ignored, never overwritten
  -- What she did before she had a business (onboarding) joins it, so her
  -- journey starts at her first screen.
  if v_acct is not null then
    update usage_views set account_id = v_acct where user_id = v_uid and account_id is null;
    update usage_events set account_id = v_acct where user_id = v_uid and account_id is null;
    update help_requests set account_id = v_acct where user_id = v_uid and account_id is null;
  end if;
end;
$fn$;

create or replace function fn_usage_event(p_kind text, p_screen text, p_path text, p_code text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_uid uuid := auth.uid(); v_acct uuid;
begin
  if v_uid is null or fn_is_platform_admin() then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('mm-usage:' || v_uid::text, 0));
  if exists (select 1 from profiles where id = v_uid and usage_opt_out_at is not null) then return; end if;
  if p_kind not in ('refusal', 'help_open', 'help_video', 'crash')
     or p_path is null or p_path !~ '^/[a-z0-9/_:-]{0,99}$'
     or (p_screen is not null and p_screen !~ '^[a-z0-9-]{1,40}$')
     or (p_code is not null and p_code !~ '^[A-Za-z0-9_]{1,24}$') then
    return;
  end if;
  if (select count(*) from usage_events where user_id = v_uid and at > now() - interval '1 hour') >= 200 then
    return;
  end if;
  select m.account_id into v_acct from memberships m where m.user_id = v_uid order by m.created_at limit 1;
  insert into usage_events (user_id, account_id, kind, screen, path, code)
  values (v_uid, v_acct, p_kind, p_screen, p_path, p_code);
end;
$fn$;

create or replace function fn_ask_for_help(
  p_screen text, p_path text, p_channel text, p_message text default null, p_device text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_uid uuid := auth.uid(); v_acct uuid; v_id bigint; v_msg text := nullif(left(trim(coalesce(p_message, '')), 1000), '');
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('message', 'whatsapp') then
    raise exception 'Unknown way to ask: %', p_channel using errcode = '22023';
  end if;
  if p_channel = 'message' and v_msg is null then
    raise exception 'Say what you were trying to do, so we can help.' using errcode = '22023';
  end if;
  if (select count(*) from help_requests where user_id = v_uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'We already have your messages from today; we will get back to you.' using errcode = '22023';
  end if;
  select m.account_id into v_acct from memberships m where m.user_id = v_uid order by m.created_at limit 1;
  insert into help_requests (user_id, account_id, screen, path, channel, message, device)
  values (v_uid, v_acct,
          case when p_screen ~ '^[a-z0-9-]{1,40}$' then p_screen end,
          case when p_path ~ '^/[a-z0-9/_:-]{0,99}$' then p_path else '/' end,
          p_channel, v_msg,
          case when p_device in ('phone', 'tablet', 'desktop') then p_device end)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'ref', 'H' || v_id);
end;
$fn$;

-- Which short question, if any, this person should see now. Never on their
-- first day in the business (their own membership, not the account's age),
-- never more than once a fortnight, each question once (the recommend
-- question every 90 days), and only to an owner or manager. "How easy was
-- your first dish / first sale" goes to the owner only: a manager who joined
-- later did not take those first steps.
create or replace function fn_feedback_due()
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare v_uid uuid := auth.uid(); v_acct uuid; v_role text; v_joined timestamptz;
begin
  if v_uid is null or fn_is_platform_admin() then return null; end if;
  select m.account_id, m.role, m.created_at into v_acct, v_role, v_joined
    from memberships m where m.user_id = v_uid order by m.created_at limit 1;
  if v_acct is null or v_role not in ('owner', 'manager') then return null; end if;
  if v_joined > now() - interval '1 day' then return null; end if;
  if exists (select 1 from feedback where user_id = v_uid and created_at > now() - interval '14 days') then
    return null;
  end if;

  if v_role = 'owner'
     and not exists (select 1 from feedback where user_id = v_uid and prompt = 'first_dish')
     and exists (select 1 from cost_snapshots s where s.account_id = v_acct and s.is_complete) then
    return 'first_dish';
  end if;
  if v_role = 'owner'
     and not exists (select 1 from feedback where user_id = v_uid and prompt = 'first_sale')
     and (exists (select 1 from orders o where o.account_id = v_acct and o.finalised_at is not null and o.voided_at is null)
          or exists (select 1 from sales_entries se where se.account_id = v_acct and se.voided_at is null)) then
    return 'first_sale';
  end if;
  if v_joined < now() - interval '30 days'
     and not exists (select 1 from feedback where user_id = v_uid and prompt = 'nps' and created_at > now() - interval '90 days')
     and (select count(distinct (started_at at time zone 'Africa/Lagos')::date) from usage_views
           where user_id = v_uid and started_at > now() - interval '30 days') >= 10 then
    return 'nps';
  end if;
  return null;
end;
$fn$;

create or replace function fn_give_feedback(p_prompt text, p_score integer, p_comment text default null, p_screen text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_uid uuid := auth.uid(); v_acct uuid;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_prompt is null or p_prompt not in ('first_dish', 'first_sale', 'nps') then
    raise exception 'Unknown question: %', p_prompt using errcode = '22023';
  end if;
  if p_score is not null and (p_score < 0 or p_score > 10 or (p_prompt <> 'nps' and p_score < 1) or (p_prompt <> 'nps' and p_score > 5)) then
    raise exception 'That answer is not on the scale.' using errcode = '22023';
  end if;
  -- An answer only to the question she is being asked now (who, when, how
  -- often: fn_feedback_due), one at a time: nobody can fill the figures with
  -- answers nobody asked for, and a second answer finds nothing due.
  perform pg_advisory_xact_lock(hashtextextended('mm-usage:' || v_uid::text, 0));
  if fn_feedback_due() is distinct from p_prompt then
    return;
  end if;
  select m.account_id into v_acct from memberships m where m.user_id = v_uid order by m.created_at limit 1;
  insert into feedback (user_id, account_id, prompt, score, comment, screen)
  values (v_uid, v_acct, p_prompt, p_score, nullif(left(trim(coalesce(p_comment, '')), 500), ''),
          case when p_screen ~ '^[a-z0-9-]{1,40}$' then p_screen end);
end;
$fn$;

create or replace function fn_set_my_usage_tracking(p_on boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  -- the same lock as fn_usage_beat and fn_usage_event: nothing of hers is
  -- written between the switch and the delete
  perform pg_advisory_xact_lock(hashtextextended('mm-usage:' || v_uid::text, 0));
  insert into profiles as p (id, usage_opt_out_at) values (v_uid, case when p_on then null else now() end)
  on conflict (id) do update
    set usage_opt_out_at = case when p_on then null else coalesce(p.usage_opt_out_at, now()) end;
  -- An objection (NDPA s.36) stops the recording AND removes what was
  -- recorded. What she chose to send -- help requests, answers -- stays.
  if not p_on then
    delete from usage_views where user_id = v_uid;
    delete from usage_events where user_id = v_uid;
  end if;
end;
$fn$;

comment on function fn_usage_beat(uuid, uuid, text, text, text, integer, text) is
  'The app''s heartbeat for the screen on show: opens or updates the person''s own '
  'visit. Silent no-op for administrators, people who objected, and anything malformed.';
comment on function fn_usage_event(text, text, text, text) is
  'A refusal, help opened, help video or crash on a screen, for the person themselves.';
comment on function fn_ask_for_help(text, text, text, text, text) is
  'A help request from inside the app, with its screen. Returns {id, ref}.';
comment on function fn_feedback_due() is
  'Which short question this person should be asked now, or null.';
comment on function fn_give_feedback(text, integer, text, text) is
  'A rating, or a dismissal (no score), for one of the short questions.';
comment on function fn_set_my_usage_tracking(boolean) is
  'The person turns recording of their screens off (false) or back on (true).';

-- ---------------------------------------------------------------------------
-- 4. THE ADMIN'S READS
-- ---------------------------------------------------------------------------

-- Who is in the app now: a beat in the last 30 minutes on a screen that was
-- showing (not hidden, not left). "Live" is a beat in the last 150 seconds.
-- Only visits started in the last day are read (usage_views_started_idx):
-- the beacon starts a fresh visit after 12 hours on one screen, and stops
-- beating after 30 minutes untouched, so no live visit is older.
create or replace function fn_admin_live()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare v jsonb;
begin
  perform fn_require_platform_admin();
  with latest as (
    select distinct on (v.user_id) v.*
      from usage_views v
     where v.started_at > now() - interval '1 day'
       and v.last_seen_at > now() - interval '30 minutes'
     -- a visit closed by moving on loses to the next screen's first beat,
     -- which can land a moment before the close
     order by v.user_id, case when v.state = 'left' then v.last_seen_at - interval '150 seconds' else v.last_seen_at end desc
  ), cur as (
    select l.user_id, u.email, l.account_id, a.name as business, l.screen, l.path, l.device,
           l.started_at, l.last_seen_at, l.active_seconds, l.state,
           (l.last_seen_at > now() - interval '150 seconds' and l.state in ('active', 'idle')) as live,
           s.status as plan_status, p.price_tier
      from latest l
      join auth.users u on u.id = l.user_id
      left join accounts a on a.id = l.account_id
      left join subscriptions s on s.account_id = l.account_id
      left join plans p on p.id = s.plan_id
     where l.state <> 'left' or l.last_seen_at > now() - interval '150 seconds'
  )
  select jsonb_build_object(
    'live', (select count(*) from cur where live),
    'recent', (select count(*) from cur),
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.live desc, r.last_seen_at desc) from cur r), '[]'::jsonb),
    'by_screen', coalesce((select jsonb_agg(jsonb_build_object('screen', x.screen, 'path', x.path, 'n', x.n) order by x.n desc)
                             from (select screen, path, count(*) as n from cur where live group by screen, path) x), '[]'::jsonb),
    -- people seen today (Lagos), so a visit begun before midnight counts
    'today', (select count(distinct user_id) from usage_views
               where started_at > now() - interval '1 day'
                 and last_seen_at >= (now() at time zone 'Africa/Lagos')::date::timestamp at time zone 'Africa/Lagos')
  ) into v;
  return v;
end;
$fn$;

-- Every account's progress, last activity and the facts the stuck rules use.
-- One row per account (or just p_account_id's); the app decides what is
-- "stuck" (lib/admin/journeys.ts). Each first step is one index entry (the
-- partial indexes above); the last visit is read from the newest few.
create or replace function fn_admin_activation(p_account_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare v jsonb;
begin
  perform fn_require_platform_admin();
  with own as (
    select distinct on (account_id) account_id, user_id
      from memberships where role = 'owner'
       and (p_account_id is null or account_id = p_account_id)
     order by account_id, created_at
  ), base as (
    select a.id, a.name, a.created_at, u.email, pr.phone, pr.usage_opt_out_at,
           s.status, s.trial_ends_at, pl.price_tier, pl.tier, fn_account_is_entitled(a.id) as entitled,
           (select min(created_at) from businesses b where b.account_id = a.id and b.deleted_at is null) as business_at,
           (select min(posted_at) from purchases pu
             where pu.account_id = a.id and pu.posted_at is not null and pu.reverses is null) as purchase_at,
           (select min(computed_at) from cost_snapshots cs where cs.account_id = a.id and cs.is_complete) as costed_at,
           (select min(created_at) from recipe_prices rp where rp.account_id = a.id) as priced_at,
           least((select min(finalised_at) from orders o
                   where o.account_id = a.id and o.finalised_at is not null and o.voided_at is null),
                 (select min(created_at) from sales_entries se where se.account_id = a.id and se.voided_at is null)) as sale_at,
           (select min(received_at) from billing_events be where be.account_id = a.id
              and be.event_type = 'charge.success' and be.status = 'applied') as paid_at,
           (select max(x.last_seen_at) from (select uv.last_seen_at from usage_views uv
              where uv.account_id = a.id order by uv.started_at desc limit 5) x) as seen_at,
           -- read through jsonb: the column is Supabase's, not in every auth.users
           (select max((to_jsonb(uu) ->> 'last_sign_in_at')::timestamptz)
              from memberships m join auth.users uu on uu.id = m.user_id where m.account_id = a.id) as signed_in_at,
           -- Lagos days, today and the 13 before it
           (select count(distinct (started_at at time zone 'Africa/Lagos')::date) from usage_views uv
             where uv.account_id = a.id
               and uv.started_at >= (((now() at time zone 'Africa/Lagos')::date - 13)::timestamp at time zone 'Africa/Lagos')) as active_days_14,
           (select count(*) from usage_events ue where ue.account_id = a.id and ue.kind = 'refusal'
              and ue.at > now() - interval '1 day') as refusals_24h,
           (select count(*) from help_requests h where h.account_id = a.id and h.status = 'open') as open_help,
           lo.score as low_score, lo.prompt as low_prompt, lo.created_at as low_score_at,
           -- only a check-in that reached them answers a low rating: not "no
           -- reply", not "wrong number" (0068 outcomes)
           (select max(c.done_at) from admin_checkins c
             where c.account_id = a.id and c.outcome in ('reached', 'opted_out', 'stopped_offers')) as last_checkin_at
      from accounts a
      left join own o on o.account_id = a.id
      left join auth.users u on u.id = o.user_id
      left join profiles pr on pr.id = o.user_id
      left join subscriptions s on s.account_id = a.id
      left join plans pl on pl.id = s.plan_id
      -- the newest LOW answer of the last 30 days (1-2 of 5, 0-6 of 10), from
      -- anyone in the business: a later good answer does not hide it
      left join lateral (select f.score, f.prompt, f.created_at from feedback f
                          where f.account_id = a.id and f.score is not null
                            and f.created_at > now() - interval '30 days'
                            and f.score <= case when f.prompt = 'nps' then 6 else 2 end
                          order by f.created_at desc limit 1) lo on true
     where a.deleted_at is null
       and (p_account_id is null or a.id = p_account_id)
  )
  select coalesce(jsonb_agg(to_jsonb(b) order by b.created_at desc), '[]'::jsonb) into v from base b;
  return v;
end;
$fn$;

create or replace function fn_admin_journey(p_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare v jsonb;
begin
  perform fn_require_platform_admin();
  if not exists (select 1 from accounts where id = p_account_id) then
    return null;
  end if;
  select jsonb_build_object(
    'account', (select to_jsonb(x) from (select a.id, a.name, a.created_at from accounts a where a.id = p_account_id) x),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', u.email, 'role', m.role,
                                  'phone', pr.phone, 'opted_out_usage', pr.usage_opt_out_at is not null) order by m.created_at)
                           from memberships m join auth.users u on u.id = m.user_id
                           left join profiles pr on pr.id = m.user_id
                          where m.account_id = p_account_id), '[]'::jsonb),
    'visits', coalesce((select jsonb_agg(to_jsonb(x) order by x.started_at desc) from (
        select v.id, v.session_id, v.user_id, v.screen, v.path, v.device, v.started_at, v.last_seen_at, v.active_seconds, v.state
          from usage_views v where v.account_id = p_account_id order by v.started_at desc limit 300) x), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc) from (
        select e.kind, e.screen, e.path, e.code, e.at, e.user_id
          from usage_events e where e.account_id = p_account_id order by e.at desc limit 200) x), '[]'::jsonb),
    'help', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        (select h.id, h.screen, h.path, h.channel, h.message, h.status, h.note, h.created_at, h.handled_at, h.user_id
           from help_requests h where h.account_id = p_account_id and h.status = 'open')
        union all
        (select h.id, h.screen, h.path, h.channel, h.message, h.status, h.note, h.created_at, h.handled_at, h.user_id
           from help_requests h where h.account_id = p_account_id and h.status <> 'open'
          order by h.created_at desc limit 50)) x), '[]'::jsonb),
    'feedback', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select f.prompt, f.score, f.comment, f.screen, f.created_at
          from feedback f where f.account_id = p_account_id order by f.created_at desc limit 50) x), '[]'::jsonb),
    'checkins', coalesce((select jsonb_agg(to_jsonb(x) order by x.done_at desc) from (
        select c.kind, c.channel, c.outcome, c.note, c.done_at
          from admin_checkins c where c.account_id = p_account_id order by c.done_at desc limit 50) x), '[]'::jsonb)
  ) into v;
  return v;
end;
$fn$;

-- Help to answer, ratings, and where refusals happen. Every open request
-- (none is ever cut), then up to 200 answered in the last 30 days. The rating
-- figures are worked from every answer of the last 90 days; only the list of
-- answers shown is limited.
create or replace function fn_admin_help()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare v jsonb;
begin
  perform fn_require_platform_admin();
  with req as (
    (select h.* from help_requests h where h.status = 'open')
    union all
    (select h.* from help_requests h
      where h.status <> 'open' and h.created_at > now() - interval '30 days'
      order by h.created_at desc limit 200)
  ), fb as (
    select f.* from feedback f where f.created_at > now() - interval '90 days'
  )
  select jsonb_build_object(
    'requests', coalesce((select jsonb_agg(jsonb_build_object(
        'id', h.id, 'account_id', h.account_id, 'business', a.name, 'email', u.email, 'phone', pr.phone,
        'screen', h.screen, 'path', h.path, 'channel', h.channel, 'message', h.message, 'device', h.device,
        'status', h.status, 'note', h.note, 'created_at', h.created_at, 'handled_at', h.handled_at)
        order by (h.status = 'open') desc, h.created_at desc)
        from req h
        join auth.users u on u.id = h.user_id
        left join profiles pr on pr.id = h.user_id
        left join accounts a on a.id = h.account_id), '[]'::jsonb),
    'open_count', (select count(*) from help_requests where status = 'open'),
    'feedback', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select f.prompt, f.score, f.comment, f.screen, f.created_at, f.account_id, a.name as business, u.email
          from fb f
          join auth.users u on u.id = f.user_id
          left join accounts a on a.id = f.account_id
         order by f.created_at desc limit 300) x), '[]'::jsonb),
    'scores', jsonb_build_object(
        'asked', (select count(*) from fb),
        'answered', (select count(*) from fb where score is not null),
        'nps', coalesce((select jsonb_agg(score) from fb where prompt = 'nps' and score is not null), '[]'::jsonb),
        'ease', coalesce((select jsonb_agg(score) from fb where prompt <> 'nps' and score is not null), '[]'::jsonb)),
    'refusals', coalesce((select jsonb_agg(to_jsonb(x) order by x.n desc) from (
        select e.screen, e.path, count(*) as n, count(distinct e.user_id) as people
          from usage_events e
         where e.kind = 'refusal' and e.at > now() - interval '7 days'
         group by e.screen, e.path order by count(*) desc limit 10) x), '[]'::jsonb)
  ) into v;
  return v;
end;
$fn$;

create or replace function fn_admin_set_help_status(p_id bigint, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  perform fn_require_platform_admin();
  if p_status is null or p_status not in ('open', 'replied', 'resolved') then
    raise exception 'Unknown status: %', p_status using errcode = '22023';
  end if;
  update help_requests
     set status = p_status,
         handled_by = case when p_status = 'open' then null else auth.uid() end,
         handled_at = case when p_status = 'open' then null else now() end,
         -- no note given keeps the one there; an emptied box clears it
         note = case when p_note is null then note else nullif(left(trim(p_note), 500), '') end
   where id = p_id;
  if not found then
    raise exception 'No such help request.' using errcode = 'P0002';
  end if;
end;
$fn$;

-- Raw visits and events older than 90 days go (help requests and ratings stay).
create or replace function fn_usage_purge()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_views int; v_events int;
begin
  delete from usage_views where started_at < now() - interval '90 days';
  get diagnostics v_views = row_count;
  delete from usage_events where at < now() - interval '90 days';
  get diagnostics v_events = row_count;
  return jsonb_build_object('views', v_views, 'events', v_events);
end;
$fn$;

comment on function fn_admin_live() is 'Platform administrators only. Who is in the app now, on which screen.';
comment on function fn_admin_activation(uuid) is 'Platform administrators only. Every account''s progress, last activity and friction counts.';
comment on function fn_admin_journey(uuid) is 'Platform administrators only. One account''s visits, friction, help, ratings and check-ins.';
comment on function fn_admin_help() is 'Platform administrators only. Help requests, ratings, and the screens with most refusals.';
comment on function fn_admin_set_help_status(bigint, text, text) is 'Platform administrators only. Marks a help request open, replied or resolved.';
comment on function fn_usage_purge() is 'Deletes screen visits and friction events older than 90 days. Run nightly.';

revoke all on function fn_usage_beat(uuid, uuid, text, text, text, integer, text) from public, anon;
revoke all on function fn_usage_event(text, text, text, text) from public, anon;
revoke all on function fn_ask_for_help(text, text, text, text, text) from public, anon;
revoke all on function fn_feedback_due() from public, anon;
revoke all on function fn_give_feedback(text, integer, text, text) from public, anon;
revoke all on function fn_set_my_usage_tracking(boolean) from public, anon;
revoke all on function fn_admin_live() from public, anon;
revoke all on function fn_admin_activation(uuid) from public, anon;
revoke all on function fn_admin_journey(uuid) from public, anon;
revoke all on function fn_admin_help() from public, anon;
revoke all on function fn_admin_set_help_status(bigint, text, text) from public, anon;
revoke all on function fn_usage_purge() from public, anon, authenticated;
grant execute on function fn_usage_beat(uuid, uuid, text, text, text, integer, text) to authenticated;
grant execute on function fn_usage_event(text, text, text, text) to authenticated;
grant execute on function fn_ask_for_help(text, text, text, text, text) to authenticated;
grant execute on function fn_feedback_due() to authenticated;
grant execute on function fn_give_feedback(text, integer, text, text) to authenticated;
grant execute on function fn_set_my_usage_tracking(boolean) to authenticated;
grant execute on function fn_admin_live() to authenticated;
grant execute on function fn_admin_activation(uuid) to authenticated;
grant execute on function fn_admin_journey(uuid) to authenticated;
grant execute on function fn_admin_help() to authenticated;
grant execute on function fn_admin_set_help_status(bigint, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. THE NIGHTLY PURGE, where pg_cron exists
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mm-usage-purge', '17 2 * * *', 'select public.fn_usage_purge();');
    raise notice '0069: pg_cron job mm-usage-purge scheduled nightly (02:17 UTC).';
  else
    raise notice '0069: pg_cron is not enabled on this database; fn_usage_purge() is not scheduled.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 6. SELF-CHECK
-- ---------------------------------------------------------------------------
do $$
declare v_fns int; v_pols int; b record; t text;
begin
  select fns, pols into b from _mm0069_before;
  select count(*) into v_fns from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%';
  select count(*) into v_pols from pg_policies where schemaname='public';
  if v_pols <> b.pols then
    raise exception '0069 self-check FAILED: policy count moved from % to %; 0069 adds none.', b.pols, v_pols;
  end if;
  if v_fns <> b.fns + 12 then
    raise exception '0069 self-check FAILED: fn_* went from % to %, expected +12.', b.fns, v_fns;
  end if;
  foreach t in array array['usage_views', 'usage_events', 'help_requests', 'feedback'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception '0069 self-check FAILED: RLS is off on %.', t;
    end if;
    if has_table_privilege('authenticated', 'public.' || t, 'select,insert,update,delete')
       or has_table_privilege('anon', 'public.' || t, 'select,insert,update,delete') then
      raise exception '0069 self-check FAILED: a client role can reach % directly.', t;
    end if;
  end loop;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and prosecdef
        and proname in ('fn_usage_beat','fn_usage_event','fn_ask_for_help','fn_give_feedback','fn_feedback_due',
                        'fn_set_my_usage_tracking','fn_admin_live','fn_admin_activation','fn_admin_journey',
                        'fn_admin_help','fn_admin_set_help_status','fn_usage_purge')) <> 12 then
    raise exception '0069 self-check FAILED: a 0069 function is not security definer.';
  end if;
  if has_function_privilege('anon', 'fn_usage_beat(uuid, uuid, text, text, text, integer, text)', 'execute')
     or has_function_privilege('anon', 'fn_ask_for_help(text, text, text, text, text)', 'execute')
     or has_function_privilege('anon', 'fn_admin_live()', 'execute')
     or has_function_privilege('authenticated', 'fn_usage_purge()', 'execute') then
    raise exception '0069 self-check FAILED: a function is open to the wrong role.';
  end if;
  if coalesce(current_setting('mm.fresh_install', true), '') <> 'on'
     and (v_pols <> 118 or v_fns not in (118, 123)) then
    raise exception '0069 self-check FAILED: expected 118 policies and 118 (or 123 with 0067) fn_*, found % and %.', v_pols, v_fns;
  end if;
  raise notice '0069 OK: screen visits, friction, help requests and ratings in place; 118 policies, % fn_*.', v_fns;
end
$$;
