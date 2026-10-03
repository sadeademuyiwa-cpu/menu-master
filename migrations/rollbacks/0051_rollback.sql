-- ============================================================================
-- 0051 ROLLBACK: back to the 0050 billing pipeline
--
-- Restores fn_billing_apply to its 0050 body -- byte for byte, captured from a
-- database at 0050 -- and drops fn_my_has_sales.
--
-- WHAT THIS COSTS
--   A paid subscription goes back to keeping whatever current_period_end it
--   already had, so any charge.success arriving afterwards will leave the
--   trial's end date in place again. That is the defect 0051 exists to fix, so
--   roll back only to escape a worse problem, not as tidying.
--
--   Dates already corrected are NOT reverted: the rollback changes code, never
--   a customer's period.
-- ============================================================================

drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0051 rollback ABORT: this executor is not honouring '
      'transaction control. Run it with psql --single-transaction.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from pg_proc where proname='fn_my_has_sales'
                   and pronamespace='public'::regnamespace) then
    raise exception '0051 rollback: fn_my_has_sales does not exist; 0051 is not applied.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- fn_billing_apply, exactly as 0050 left it
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
  v_ref text; v_res jsonb; v_side jsonb;
begin
  if not fn_is_service_context() then
    raise exception 'fn_billing_apply is a service-context function'
      using errcode = '42501';
  end if;

  select * into e from billing_events where id = p_event_id;
  if not found then
    raise exception 'Billing event % does not exist', p_event_id;
  end if;

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

  v_raw_plan := coalesce(nullif(e.payload #>> '{data,plan,plan_code}',''),
                         nullif(e.payload #>> '{data,metadata,plan_id}',''));

  if v_raw_plan is null then
    select s.plan_id into v_plan from subscriptions s where s.account_id = v_account;
  else
    select p.id into v_plan
      from plans p
     where p.provider_plan_code = v_raw_plan and p.is_active;

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

  if e.event_type = 'invoice.payment_failed' then
    v_period := null;
  end if;

  begin
    v_res := fn_set_subscription_plan(v_account, v_plan, v_status, v_period, v_ref);
    -- >>> 0050: the 0049 payment boundary, in the same frame as the plan change
    v_side := fn_apply_billing_side_effects(v_account, v_plan, v_status, e.payload);
    -- <<<
  exception
    when sqlstate 'P0002' or sqlstate '22023' or sqlstate '23514' then
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
                            'plan_id',v_plan,'subscription',v_res,'billing',v_side);
end;
$function$

;

revoke all on function fn_billing_apply(uuid) from public, anon, authenticated;

drop function if exists fn_my_has_sales();

do $$
begin
  if exists (select 1 from pg_proc where proname='fn_my_has_sales'
               and pronamespace='public'::regnamespace) then
    raise exception '0051 rollback FAILED: fn_my_has_sales still exists.';
  end if;
  if (select pg_get_functiondef(oid) from pg_proc where proname='fn_billing_apply'
       and pronamespace='public'::regnamespace) like '%paid_at%' then
    raise exception '0051 rollback FAILED: fn_billing_apply still derives a paid period.';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 117 then
    raise exception '0051 rollback FAILED: policy count is not 117.';
  end if;
  raise notice '0051 rollback OK: back at the 0050 billing pipeline, 117 policies.';
end
$$;
