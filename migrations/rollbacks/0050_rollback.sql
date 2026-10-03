-- ============================================================================
-- 0050 ROLLBACK: back to the 0049 billing pipeline
--
-- Restores fn_billing_apply to its 0029 body -- byte for byte, captured from a
-- database at 0049 -- and drops the two functions 0050 added.
--
-- WHAT THIS DELIBERATELY DOES NOT UNDO
--   Nothing: 0050 created no table, no column, no policy and wrote no customer
--   data. But it REFUSES if any founder slot has been confirmed, because after
--   that point fn_billing_apply is the only thing keeping a paid founder's slot
--   and price correct, and taking it away would silently strand them.
-- ============================================================================

-- Same guard as the forward migration. A rollback that half-applies is worse
-- than no rollback: it runs when something has already gone wrong.
drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0050 rollback ABORT: this executor is not honouring '
      'transaction control (each statement is committing on its own). Run it '
      'with psql --single-transaction over the Session Pooler.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from pg_proc where proname='fn_checkout_quote'
                   and pronamespace='public'::regnamespace) then
    raise exception '0050 rollback: fn_checkout_quote does not exist; 0050 is not applied.';
  end if;
  if exists (select 1 from founder_slots where claimed_at is not null) then
    raise exception '0050 rollback REFUSED: % founder slot(s) are confirmed. '
      'Rolling back would leave paid founders without the code that maintains '
      'their slot and price.',
      (select count(*) from founder_slots where claimed_at is not null);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- fn_billing_apply, exactly as 0029 left it
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_billing_apply(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e billing_events%rowtype;
  v_account uuid; v_plan text; v_raw_plan text; v_status text; v_period timestamptz;
  v_ref text; v_res jsonb;
begin
  if not fn_is_service_context() then
    raise exception 'fn_billing_apply is a service-context function'
      using errcode = '42501';
  end if;

  select * into e from billing_events where id = p_event_id;
  if not found then
    raise exception 'Billing event % does not exist', p_event_id;
  end if;

  -- section 8: Paystack event -> internal transition
  v_status := case e.event_type
    when 'charge.success'          then 'active'
    when 'subscription.create'     then 'active'
    when 'invoice.payment_failed'  then 'past_due'
    when 'subscription.not_renew'  then 'cancelled'
    when 'subscription.disable'    then 'cancelled'
    else null end;

  if v_status is null then
    update billing_events set status='ignored', applied_at=now() where id=e.id;
    return jsonb_build_object('status','ignored','reason','unsupported event type');
  end if;

  v_account := e.account_id;
  if v_account is null then
    v_account := nullif(e.payload #>> '{data,metadata,account_id}','')::uuid;
  end if;
  if v_account is null then
    update billing_events
       set status='failed_permanent', last_error_code='no_account',
           last_error='the event carries no account_id in metadata'
     where id=e.id;
    return jsonb_build_object('status','failed_permanent','reason','no account_id');
  end if;

  -- PLAN RESOLUTION (0030)
  --
  --   Paystack sends its own plan code, e.g. PLN_xxxxxxxx. Our plans are
  --   'costing', 'trading', 'trial'. The mapping lives HERE, in our database,
  --   never in Paystack -- design section 8.
  --
  --   Three cases, deliberately different:
  --     no code at all      -> keep the subscription's CURRENT plan. A failed
  --                            renewal or a cancellation changes STATUS, not
  --                            plan; the absence of a plan is not a change of
  --                            plan. Without this, a real cancellation event
  --                            raises 22023 and the customer keeps access.
  --     code that maps      -> use the mapped plan
  --     code that does NOT  -> refuse. We cannot tell what they bought, and
  --                            guessing would either bill them for the wrong
  --                            plan or give the product away.
  v_raw_plan := coalesce(nullif(e.payload #>> '{data,plan,plan_code}',''),
                         nullif(e.payload #>> '{data,metadata,plan_id}',''));

  if v_raw_plan is null then
    select s.plan_id into v_plan from subscriptions s where s.account_id = v_account;
  else
    -- a Paystack plan code we have been told about
    select p.id into v_plan
      from plans p
     where p.provider_plan_code = v_raw_plan and p.is_active;

    -- or one of our own ids, which the onboarding path and our tests use
    if v_plan is null then
      select p.id into v_plan from plans p where p.id = v_raw_plan and p.is_active;
    end if;

    if v_plan is null then
      update billing_events
         set status='failed_permanent', last_error_code='unmapped_plan_code',
             last_error='Paystack plan code '||v_raw_plan||' is not mapped to any '
                        'active plan. Set plans.provider_plan_code for it.'
       where id=e.id;
      return jsonb_build_object('status','failed_permanent',
                                'reason','unmapped plan code '||v_raw_plan);
    end if;
  end if;
  v_ref    := coalesce(e.reference, e.provider_event_id);
  v_period := nullif(e.payload #>> '{data,next_payment_date}','')::timestamptz;

  -- a failed renewal must NOT advance the period end
  if e.event_type = 'invoice.payment_failed' then
    v_period := null;
  end if;

  begin
    v_res := fn_set_subscription_plan(v_account, v_plan, v_status, v_period, v_ref);
  exception
    when sqlstate 'P0002' or sqlstate '22023' or sqlstate '23514' then
      -- refused for a reason retrying cannot fix: this is the status that
      -- matters commercially -- Paystack believes something happened and our
      -- database disagrees. It goes to the reconciliation queue for a human.
      update billing_events
         set status='failed_permanent', last_error_code=sqlstate, last_error=sqlerrm
       where id=e.id;
      return jsonb_build_object('status','failed_permanent','error',sqlerrm);
    when others then
      update billing_events
         set status='failed_transient', last_error_code=sqlstate, last_error=sqlerrm,
             next_retry_at = now() + (interval '1 minute' * power(2, least(e.attempts,6)))
       where id=e.id;
      return jsonb_build_object('status','failed_transient','error',sqlerrm);
  end;

  update billing_events
     set status='applied', applied_at=now(), account_id=v_account
   where id=e.id;
  return jsonb_build_object('status','applied','account_id',v_account,
                            'transition',v_status,'result',v_res);
end;
$function$

;

revoke all on function fn_billing_apply(uuid) from public, anon, authenticated;

drop function if exists fn_apply_billing_side_effects(uuid, text, text, jsonb);
drop function if exists fn_checkout_quote(uuid, text, interval);

do $$
begin
  if exists (select 1 from pg_proc where proname in ('fn_checkout_quote','fn_apply_billing_side_effects')
               and pronamespace='public'::regnamespace) then
    raise exception '0050 rollback FAILED: a 0050 function still exists.';
  end if;
  if (select pg_get_functiondef(oid) from pg_proc where proname='fn_billing_apply'
       and pronamespace='public'::regnamespace) like '%fn_apply_billing_side_effects%' then
    raise exception '0050 rollback FAILED: fn_billing_apply still calls the 0050 boundary.';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 117 then
    raise exception '0050 rollback FAILED: policy count is not 117.';
  end if;
  raise notice '0050 rollback OK: back at the 0049 billing pipeline, 117 policies.';
end
$$;
