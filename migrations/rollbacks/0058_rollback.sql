-- ============================================================================
-- 0058 ROLLBACK: drop the trial reminder functions and table. Back at 0057.
-- The record of who was reminded is lost with the table: re-applying 0058
-- would remind accounts again. Export trial_reminders first if that matters.
-- ============================================================================
drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0058 rollback ABORT: this executor is not honouring transaction control. '
      'Run it with psql --single-transaction.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from pg_class where relname='trial_reminders' and relnamespace='public'::regnamespace) then
    raise exception '0058 rollback: trial_reminders does not exist; 0058 is not applied.';
  end if;
end
$$;

drop function if exists fn_record_trial_reminder(uuid, text, text);
drop function if exists fn_trial_reminders_due();
drop table if exists trial_reminders;

do $$
begin
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 93 then
    raise exception '0058 rollback FAILED: fn_* count is %, expected 93.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  raise notice '0058 rollback OK: back at 0057.';
end
$$;
