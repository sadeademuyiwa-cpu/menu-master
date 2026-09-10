-- ============================================================================
-- 0030 ROLLBACK -- restores the pre-mapping plan resolution
--
-- WARNING: this REOPENS both defects 0030 closed. A real Paystack plan code
-- lands in failed_permanent, and worse, a cancellation carrying no plan object
-- also fails -- so a customer who cancels keeps access. Roll back only to
-- unblock a specific incident.
--
-- plans.provider_plan_code is DROPPED, so any codes the operator entered are
-- lost. Record them before running this.
-- ============================================================================

do $$
declare v_mapped int;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='plans'
                    and column_name='provider_plan_code') then
    raise exception '0030 rollback FAILED: provider_plan_code does not exist.';
  end if;
  select count(*) into v_mapped from plans where provider_plan_code is not null;
  raise warning '0030 rollback: dropping provider_plan_code, losing % configured '
                'mapping(s). A cancellation with no plan object will fail again '
                'and the customer will keep access.', v_mapped;
end
$$;

create or replace function fn_billing_apply(p_event_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  e billing_events%rowtype;
  v_account uuid; v_plan text; v_status text; v_period timestamptz;
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

  v_plan   := coalesce(nullif(e.payload #>> '{data,plan,plan_code}',''),
                       nullif(e.payload #>> '{data,metadata,plan_id}',''));
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
$$;

revoke execute on function fn_billing_apply(uuid) from public, anon, authenticated;
grant  execute on function fn_billing_apply(uuid) to service_role;

drop index if exists ux_plans_provider_plan_code;
alter table plans drop column if exists provider_plan_code;

do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc where proname='fn_billing_apply';
  if v_src like '%provider_plan_code%' then
    raise exception '0030 rollback self-check FAILED: the resolver survived.';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='plans'
                and column_name='provider_plan_code') then
    raise exception '0030 rollback self-check FAILED: the column survived.';
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace
       and proname like 'fn\_%') <> 57 then
    raise exception '0030 rollback self-check FAILED: fn_* count moved.';
  end if;
  raise notice '0030 ROLLBACK OK: 57 fn_*; the 0029 resolver is restored and '
               'provider_plan_code is gone. Both defects are OPEN again.';
end
$$;
