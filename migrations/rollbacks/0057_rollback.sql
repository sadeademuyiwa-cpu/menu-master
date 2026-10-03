-- ============================================================================
-- 0057 ROLLBACK: drop fn_admin_set_site_setting and site_settings.
-- Back at 0056. The website then falls back to what the code ships with:
-- no pixels, the bundled privacy policy, the landing page without pictures
-- or testimonials. Whatever the admin had written is lost -- copy it first.
-- ============================================================================
drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0057 rollback ABORT: this executor is not honouring transaction control. '
      'Run it with psql --single-transaction.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from pg_class where relname='site_settings' and relnamespace='public'::regnamespace) then
    raise exception '0057 rollback: site_settings does not exist; 0057 is not applied.';
  end if;
end
$$;

drop function if exists fn_admin_set_site_setting(text, jsonb);
drop table if exists site_settings;

do $$
begin
  if (select count(*) from pg_policies where schemaname='public') <> 117 then
    raise exception '0057 rollback FAILED: policy count is %, expected 117.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 92 then
    raise exception '0057 rollback FAILED: fn_* count is %, expected 92.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  raise notice '0057 rollback OK: back at 0056.';
end
$$;
