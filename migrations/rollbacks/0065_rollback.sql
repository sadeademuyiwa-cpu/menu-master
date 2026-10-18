-- ============================================================================
-- 0065 ROLLBACK: remove the help setting. Back at 0064.
--
-- The saved help video links are deleted with the row (they are YouTube
-- links: copy them from Platform -> Help videos first if you want them
-- back). The app shows no Help button without the row, and the admin page
-- says 0065 is needed; no app rollback is required.
-- ============================================================================
drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0065 rollback ABORT: this executor is not honouring transaction control. '
      'Run it with psql --single-transaction.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from site_settings where key = 'help') then
    raise exception '0065 rollback: there is no help setting; 0065 is not applied.';
  end if;
end
$$;

delete from site_settings where key = 'help';
alter table site_settings drop constraint ck_site_settings_key;
alter table site_settings add constraint ck_site_settings_key
  check (key in ('analytics', 'privacy', 'landing', 'company', 'signin'));

comment on table site_settings is
  'What the public website says: analytics ids, the privacy policy, landing '
  'content, company details, sign-in options. Readable by anyone (key, value, updated_at); written only through '
  'fn_admin_set_site_setting. Never store a secret here.';

do $$
begin
  if (select string_agg(key, ',' order by key) from site_settings) <> 'analytics,company,landing,privacy,signin' then
    raise exception '0065 rollback FAILED: site_settings holds %.',
      (select string_agg(key, ',' order by key) from site_settings);
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 118 then
    raise exception '0065 rollback FAILED: policy count is %, expected 118.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
  raise notice '0065 rollback OK: back at 0064. No screen shows a Help button.';
end
$$;
