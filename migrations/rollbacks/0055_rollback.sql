-- ============================================================================
-- 0055 ROLLBACK: unschedule the scan, drop the alert functions and the table.
-- Byte-faithful to 0054. The alert rows are lost with the table; export them
-- first if they matter (select * from platform_alerts).
-- ============================================================================
drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0055 rollback ABORT: this executor is not honouring transaction control. '
      'Run it with psql --single-transaction.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from pg_class where relname='platform_alerts' and relnamespace='public'::regnamespace) then
    raise exception '0055 rollback: platform_alerts does not exist; 0055 is not applied.';
  end if;
  -- nested, not AND-ed: cron.job does not exist without the extension and
  -- SQL does not promise to short-circuit
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'mm-admin-scan') then
      perform cron.unschedule('mm-admin-scan');
    end if;
  end if;
end
$$;

drop function if exists fn_admin_resolve_alert(uuid, text);
drop function if exists fn_admin_alerts(boolean);
drop function if exists fn_admin_scan();
drop table if exists platform_alerts;

do $$
begin
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 82 then
    raise exception '0055 rollback FAILED: fn_* count is %, expected 82.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  raise notice '0055 rollback OK: back at 0054.';
end
$$;
