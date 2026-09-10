-- ============================================================================
-- 0054 ROLLBACK: drop the three admin reads. Byte-faithful to 0053.
-- ============================================================================
drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0054 rollback ABORT: this executor is not honouring transaction control. '
      'Run it with psql --single-transaction.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from pg_proc where proname='fn_admin_subscriptions' and pronamespace='public'::regnamespace) then
    raise exception '0054 rollback: fn_admin_subscriptions does not exist; 0054 is not applied.';
  end if;
end
$$;

drop function if exists fn_admin_billing_health(integer);
drop function if exists fn_admin_subscriptions();
drop function if exists fn_admin_signups(integer);

do $$
begin
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 79 then
    raise exception '0054 rollback FAILED: fn_* count is %, expected 79.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  raise notice '0054 rollback OK: back at 0053.';
end
$$;
