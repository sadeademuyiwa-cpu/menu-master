-- ============================================================================
-- MENU MASTER NG
-- 0057: what the public website says, edited by a platform admin
--
-- Requires: 0001-0056 applied.
--
-- WHY
--   The public landing page, the privacy policy and the advertising pixels
--   change with marketing, not with releases. The owner asked for all three
--   to be editable from the admin panel rather than written into the code:
--     analytics   pixel and tag ids (Meta, Google Ads, Google Analytics,
--                 PostHog)
--     privacy     the privacy policy's text
--     landing     logo, pictures, testimonials, WhatsApp number
--     company     the legal name, RC number, address and support email the
--                 legal pages state
--     signin      whether "Continue with Google" is offered (the provider
--                 itself is configured in Supabase)
--
-- HOW
--   site_settings       one row per key above, the value a jsonb object.
--                       Exactly five rows, created here, never deleted.
--   READ                anyone, including a logged-out visitor: it is the
--                       public website. One SELECT policy (using true), and a
--                       COLUMN grant of (key, value, updated_at) only to anon
--                       and authenticated -- updated_by names a platform
--                       admin, and the repository's rule since 0053 is that
--                       nothing public says who administers production.
--   WRITE               no client grant at all. fn_admin_set_site_setting is
--                       the only way in, and it opens with
--                       fn_require_platform_admin() like every fn_admin_*.
--
-- WHAT THIS DELIBERATELY CHANGES
--   policies   117 -> 118 (the one SELECT policy above).
--   anon       may now read three columns of one more table. Test 009 pins
--              anon's TABLE grants (unchanged: this is a column grant) and
--              now also pins its column grants to exactly these three.
--   Nothing here is a secret: every pixel id ends up in the page source
--   anyway. Do not store a key that must stay private in this table.
-- ============================================================================

drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0057 ABORT: this executor is not honouring transaction control '
      '(each statement is committing on its own). Run it with '
      'psql --single-transaction over the Session Pooler.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from pg_proc where proname='fn_accept_invitations'
                   and pronamespace='public'::regnamespace) then
    raise exception '0057 preflight FAILED: fn_accept_invitations is missing. Apply 0056 first.';
  end if;
  if not exists (select 1 from pg_proc where proname='fn_require_platform_admin'
                   and pronamespace='public'::regnamespace) then
    raise exception '0057 preflight FAILED: fn_require_platform_admin is missing. Apply 0053 first.';
  end if;
  if exists (select 1 from pg_class where relname='site_settings' and relnamespace='public'::regnamespace) then
    raise exception '0057 preflight FAILED: site_settings already exists.';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 117 then
    raise exception '0057 preflight FAILED: policy count is %, expected 117.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 92 then
    raise exception '0057 preflight FAILED: fn_* count is %, expected 92.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table site_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null,
  constraint ck_site_settings_key    check (key in ('analytics', 'privacy', 'landing', 'company', 'signin')),
  constraint ck_site_settings_object check (jsonb_typeof(value) = 'object'),
  -- Generous for a privacy policy and a dozen testimonials; a ceiling so a
  -- slip cannot put megabytes on every public page load.
  constraint ck_site_settings_size   check (pg_column_size(value) <= 200000)
);

comment on table site_settings is
  'What the public website says: analytics ids, the privacy policy, landing '
  'content, company details, sign-in options. Readable by anyone (key, value, updated_at); written only through '
  'fn_admin_set_site_setting. Never store a secret here.';

-- Every foreign key has a covering index (the rule since 0052).
create index ix_fk_site_settings_updated_by on site_settings (updated_by);

insert into site_settings (key) values ('analytics'), ('privacy'), ('landing'), ('company'), ('signin');

alter table site_settings enable row level security;

create policy p_site_settings_select on site_settings
  for select to anon, authenticated
  using (true);

revoke all on site_settings from public, anon, authenticated;
grant select (key, value, updated_at) on site_settings to anon, authenticated;
grant all on site_settings to service_role;

-- ---------------------------------------------------------------------------
-- 2. The one way to change it
-- ---------------------------------------------------------------------------
create or replace function fn_admin_set_site_setting(p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare r site_settings%rowtype;
begin
  perform fn_require_platform_admin();
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception 'A setting is a set of named values' using errcode = '22023';
  end if;
  update site_settings
     set value = p_value, updated_at = now(), updated_by = auth.uid()
   where key = p_key
   returning * into r;
  if r.key is null then
    raise exception 'There is no setting called %', p_key using errcode = 'P0002';
  end if;
  return jsonb_build_object('key', r.key, 'updated_at', r.updated_at);
end;
$fn$;

revoke all on function fn_admin_set_site_setting(text, jsonb) from public, anon;
grant execute on function fn_admin_set_site_setting(text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from pg_policies where schemaname='public') <> 118 then
    raise exception '0057 self-check FAILED: policy count is %, expected 118.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 93 then
    raise exception '0057 self-check FAILED: fn_* count is %, expected 93.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  if not (select relrowsecurity from pg_class where relname='site_settings') then
    raise exception '0057 self-check FAILED: RLS is not enabled on site_settings.';
  end if;
  if has_column_privilege('anon', 'site_settings', 'updated_by', 'select')
     or has_column_privilege('authenticated', 'site_settings', 'updated_by', 'select') then
    raise exception '0057 self-check FAILED: a client role can see which admin edited the site.';
  end if;
  if has_table_privilege('anon', 'site_settings', 'insert,update,delete,truncate')
     or has_table_privilege('authenticated', 'site_settings', 'insert,update,delete,truncate') then
    raise exception '0057 self-check FAILED: a client role can write site_settings directly.';
  end if;
  if has_function_privilege('anon', 'fn_admin_set_site_setting(text, jsonb)', 'execute') then
    raise exception '0057 self-check FAILED: anon can call fn_admin_set_site_setting.';
  end if;
  if not exists (select 1 from pg_proc p where p.proname='fn_admin_set_site_setting'
                   and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public')) then
    raise exception '0057 self-check FAILED: fn_admin_set_site_setting does not pin search_path.';
  end if;
  if not exists (select 1 from pg_class where relname='ix_fk_site_settings_updated_by' and relkind='i') then
    raise exception '0057 self-check FAILED: site_settings.updated_by has no covering index.';
  end if;
  if (select count(*) from site_settings) <> 5 then
    raise exception '0057 self-check FAILED: expected the five settings rows.';
  end if;
  raise notice '0057 OK: site_settings (five rows, readable by anyone, written only by a platform '
               'admin); 118 policies; fn_admin_set_site_setting.';
end
$$;
