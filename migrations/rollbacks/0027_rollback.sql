-- ============================================================================
-- 0027 ROLLBACK -- removes the billing audit trail
--
-- WARNING, from the design itself: "Dropping it destroys the audit trail, so it
-- is a development rollback, not a production one. In production the reversal
-- is to stop the Edge Function and leave the table."
--
-- The preflight below refuses to run once any event has been recorded. If you
-- genuinely need to drop a populated billing_events, export it first -- it is
-- the only record that money moved.
-- ============================================================================

do $$
declare v_rows int;
begin
  if to_regclass('public.billing_events') is null then
    raise exception '0027 rollback FAILED: billing_events does not exist.';
  end if;

  select count(*) into v_rows from billing_events;
  if v_rows > 0 then
    raise exception '0027 rollback REFUSED: % billing event(s) recorded. This '
                    'table is the evidence that money moved. Export it before '
                    'dropping it, or stop the Edge Function and leave the table '
                    'in place -- which is what the design recommends in '
                    'production.', v_rows;
  end if;
  raise notice '0027 rollback: table is empty, safe to drop.';
end
$$;

drop view     if exists v_billing_reconciliation;
drop table    if exists billing_events;
drop function if exists fn_redact_billing_payload();

do $$
declare v_fns int; v_rels int;
begin
  select count(*) into v_fns from pg_proc
   where pronamespace='public'::regnamespace and proname like 'fn\_%';
  select count(*) into v_rels from pg_class
   where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f');
  if v_fns <> 53 or v_rels <> 49 then
    raise exception '0027 rollback self-check FAILED: % / %, expected 53 / 49.',
      v_fns, v_rels;
  end if;
  raise notice '0027 ROLLBACK OK: back to 53 fn_* / 49 relations. Gate 2 untouched.';
end
$$;
