-- ============================================================================
-- 0029 ROLLBACK -- removes the ingest and apply functions
--
-- Safe: they store nothing of their own and nothing else calls them. The
-- billing_events rows they wrote remain, because that table is the evidence
-- that money moved and 0027's rollback refuses to drop it once populated.
--
-- Deploy order is migration first, then the Edge Function; removal order is the
-- reverse. STOP THE EDGE FUNCTION BEFORE RUNNING THIS, or a live webhook will
-- start failing with 500s and Paystack will retry into a wall.
-- ============================================================================

do $$
begin
  if (select count(*) from pg_proc
       where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 57 then
    raise exception '0029 rollback FAILED: expected 57 fn_* functions, found %.',
      (select count(*) from pg_proc
        where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  raise warning '0029 rollback: stop the paystack-webhook Edge Function FIRST. '
                'Without these functions it returns 500 and Paystack retries.';
end
$$;

drop function if exists fn_billing_apply(uuid);
drop function if exists fn_billing_ingest(text,boolean,text,text,text,jsonb,integer,inet);

do $$
declare v_fns int;
begin
  select count(*) into v_fns from pg_proc
   where pronamespace='public'::regnamespace and proname like 'fn\_%';
  if v_fns <> 55 then
    raise exception '0029 rollback self-check FAILED: fn_* is %, expected 55.', v_fns;
  end if;
  if to_regclass('public.billing_events') is null then
    raise exception '0029 rollback self-check FAILED: billing_events was dropped. '
                    'The audit trail must survive this rollback.';
  end if;
  raise notice '0029 ROLLBACK OK: back to 55 fn_*; billing_events and its % row(s) '
               'left intact.', (select count(*) from billing_events);
end
$$;
