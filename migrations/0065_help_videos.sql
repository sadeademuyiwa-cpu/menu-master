-- ============================================================================
-- MENU MASTER NG
-- 0065: a help video for each screen, chosen by a platform admin
--
-- Requires: 0001-0064 applied.
--
-- WHY
--   The owner is recording a short "how to use this screen" video for every
--   screen, from logging in to recording a sale, and hosting them on
--   YouTube. The links change with the videos, not with releases, so they
--   are edited in the admin panel (Platform -> Help videos), like the rest
--   of what the website says (0057). The app shows a Help button at the top
--   of a screen when that screen has a video.
--
-- HOW
--   site_settings   gains a sixth row, 'help': a jsonb object of screen key
--                   -> YouTube link, e.g. {"sale-new": "https://www.youtube.com/watch?v=..."}.
--                   The app keeps only known screens with real YouTube ids
--                   (web/src/lib/site/help-videos.ts), so a stray value
--                   cannot reach the player.
--                   ck_site_settings_key admits 'help'; that is all.
--   READ / WRITE    unchanged from 0057: anyone reads (key, value,
--                   updated_at) -- the links are public videos -- and only
--                   fn_admin_set_site_setting writes, after
--                   fn_require_platform_admin().
--
-- WHAT DOES NOT CHANGE
--   No policy (118), no function (99 fn_*), no grant. Test 043 now expects
--   six rows instead of five.
-- ============================================================================

drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0065 ABORT: this executor is not honouring transaction control '
      '(each statement is committing on its own). Run it with '
      'psql --single-transaction over the Session Pooler.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if to_regprocedure('public.fn_menu_prices()') is null then
    raise exception '0065 preflight FAILED: fn_menu_prices is missing. Apply 0064 first.';
  end if;
  if to_regprocedure('public.fn_admin_set_site_setting(text, jsonb)') is null then
    raise exception '0065 preflight FAILED: fn_admin_set_site_setting is missing (0057).';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_site_settings_key'
                   and conrelid = 'public.site_settings'::regclass) then
    raise exception '0065 preflight FAILED: site_settings has no ck_site_settings_key to widen.';
  end if;
  if exists (select 1 from site_settings where key = 'help') then
    raise exception '0065 preflight FAILED: the help setting already exists; 0065 is applied.';
  end if;
  if (select string_agg(key, ',' order by key) from site_settings) <> 'analytics,company,landing,privacy,signin' then
    raise exception '0065 preflight FAILED: site_settings holds %, expected the five rows of 0057.',
      (select string_agg(key, ',' order by key) from site_settings);
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 118 then
    raise exception '0065 preflight FAILED: policy count is %, expected 118.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 99 then
    raise exception '0065 preflight FAILED: fn_* count is %, expected 99.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. The sixth setting
-- ---------------------------------------------------------------------------
alter table site_settings drop constraint ck_site_settings_key;
alter table site_settings add constraint ck_site_settings_key
  check (key in ('analytics', 'privacy', 'landing', 'company', 'signin', 'help'));

insert into site_settings (key) values ('help');

comment on table site_settings is
  'What the public website says: analytics ids, the privacy policy, landing '
  'content, company details, sign-in options, and each screen''s help video. '
  'Readable by anyone (key, value, updated_at); written only through '
  'fn_admin_set_site_setting. Never store a secret here.';

-- ---------------------------------------------------------------------------
-- 2. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if (select string_agg(key, ',' order by key) from site_settings) <> 'analytics,company,help,landing,privacy,signin' then
    raise exception '0065 self-check FAILED: site_settings holds %.',
      (select string_agg(key, ',' order by key) from site_settings);
  end if;
  if (select value from site_settings where key = 'help') <> '{}'::jsonb then
    raise exception '0065 self-check FAILED: the help setting does not start empty.';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 118 then
    raise exception '0065 self-check FAILED: 0065 must add no policy.';
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 99 then
    raise exception '0065 self-check FAILED: fn_* count is %, expected 99.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  if has_table_privilege('anon', 'site_settings', 'insert,update,delete,truncate')
     or has_table_privilege('authenticated', 'site_settings', 'insert,update,delete,truncate') then
    raise exception '0065 self-check FAILED: a client role may write site_settings directly.';
  end if;
  raise notice '0065 OK: site_settings has its sixth row, help (empty); 118 policies, 99 fn_*.';
end
$$;
