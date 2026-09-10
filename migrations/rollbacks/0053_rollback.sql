-- ============================================================================
-- 0053 ROLLBACK: remove the platform_admins table and its two helpers.
-- Byte-faithful to 0052. Anything 0054/0055 built on these must be rolled
-- back first (their rollbacks check for this).
-- ============================================================================
drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0053 rollback ABORT: this executor is not honouring transaction control. '
      'Run it with psql --single-transaction.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from pg_class where relname='platform_admins' and relnamespace='public'::regnamespace) then
    raise exception '0053 rollback: platform_admins does not exist; 0053 is not applied.';
  end if;
  if exists (select 1 from pg_proc where proname in ('fn_admin_subscriptions','fn_admin_scan')
               and pronamespace='public'::regnamespace) then
    raise exception '0053 rollback: 0054/0055 objects still exist. Roll those back first.';
  end if;
end
$$;

drop function if exists fn_require_platform_admin();
drop function if exists fn_is_platform_admin();
drop table if exists platform_admins;

do $$
begin
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 77 then
    raise exception '0053 rollback FAILED: fn_* count is %, expected 77.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  raise notice '0053 rollback OK: back at 0052.';
end
$$;
