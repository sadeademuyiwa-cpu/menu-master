-- ============================================================================
-- MENU MASTER NG
-- 0030: Paystack plan-code mapping -- GATE 3
--
-- Authority: docs/BILLING_INTEGRATION_DESIGN.md section 8, which states that
-- Paystack's vocabulary is mapped at the boundary and never persisted.
-- Requires: 0021-0029 applied (57 fn_* / 51 relations / 105 policies).
--
-- TWO DEFECTS THIS CLOSES, both found by verifying against production rather
-- than by reading.
--
--   1. PLAN CODES DO NOT MATCH. Paystack sends its own code, e.g. PLN_xxxxxxxx.
--      Our plans are 'costing', 'trading', 'trial'. fn_billing_apply passed the
--      incoming code straight to fn_set_subscription_plan, which requires a
--      real plans.id and raises 22023 otherwise. Every real payment would have
--      landed in failed_permanent. The live test passed only because the
--      payload was hand-written with one of OUR ids in it.
--
--   2. AN EVENT WITH NO PLAN WAS TREATED AS AN ERROR. invoice.payment_failed
--      and subscription.not_renew change STATUS, not plan, and may carry no
--      plan object at all. The old code passed NULL, which also raises 22023.
--      A genuine cancellation would have been recorded failed_permanent and
--      never applied -- and the customer would have kept access. This is the
--      more dangerous of the two.
--
-- THE RULE NOW, and the three cases are deliberately different:
--   no plan code            keep the subscription's current plan
--   code that maps          use the mapped plan
--   code that does not map  REFUSE, with the named code 'unmapped_plan_code'
--
-- Refusing rather than guessing follows the governing rule: absent data stays
-- absent, but unrecognised data is an error. Guessing would either bill for the
-- wrong plan or give the product away.
--
-- NO PLAN CODE IS SEEDED HERE. provider_plan_code starts NULL on every row and
-- must be set from the operator's own Paystack dashboard. An invented code
-- would be exactly the fabricated data this project forbids.
-- ============================================================================

do $$
begin
  if (select count(*) from pg_proc
       where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 57 then
    raise exception '0030 preflight FAILED: expected 57 fn_* functions, found %.',
      (select count(*) from pg_proc
        where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='plans'
                and column_name='provider_plan_code') then
    raise exception '0030 preflight FAILED: provider_plan_code already exists.';
  end if;
  raise notice '0030 preflight OK. % active plan(s) will need a code.',
    (select count(*) from plans where is_active);
end
$$;

-- ----------------------------------------------------------------------------
-- 1. Where the mapping lives
-- ----------------------------------------------------------------------------
alter table plans add column provider_plan_code text;

comment on column plans.provider_plan_code is
  'The payment provider''s own plan code, e.g. Paystack PLN_xxxxxxxx. NULL until '
  'the operator supplies it. Never invented: an unmapped code is refused, not guessed.';

-- one Paystack plan may map to at most one of ours
create unique index ux_plans_provider_plan_code
  on plans (provider_plan_code) where provider_plan_code is not null;

-- ----------------------------------------------------------------------------
-- 2. The resolver, inside fn_billing_apply
-- ----------------------------------------------------------------------------
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
$function$;

revoke execute on function fn_billing_apply(uuid) from public, anon, authenticated;
grant  execute on function fn_billing_apply(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 3. SELF-CHECK
-- ----------------------------------------------------------------------------
do $$
declare v_fns int; v_src text; v_seeded int;
begin
  select count(*) into v_fns from pg_proc
   where pronamespace='public'::regnamespace and proname like 'fn\_%';
  if v_fns <> 57 then
    raise exception '0030 self-check FAILED: fn_* is %, expected 57. This '
                    'migration replaces a function; it must not add one.', v_fns;
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='plans'
                    and column_name='provider_plan_code') then
    raise exception '0030 self-check FAILED: provider_plan_code is missing.';
  end if;

  select prosrc into v_src from pg_proc where proname='fn_billing_apply';
  if v_src not like '%provider_plan_code%' then
    raise exception '0030 self-check FAILED: the resolver was not installed.';
  end if;
  if v_src not like '%unmapped_plan_code%' then
    raise exception '0030 self-check FAILED: an unmapped code is not refused by name.';
  end if;

  -- nothing may be seeded: an invented plan code is fabricated data
  select count(*) into v_seeded from plans where provider_plan_code is not null;
  if v_seeded <> 0 then
    raise exception '0030 self-check FAILED: % plan(s) already carry a provider '
                    'code. This migration must not invent one.', v_seeded;
  end if;

  if (select count(*) from pg_proc p
       where p.proname='fn_billing_apply'
         and (has_function_privilege('anon', p.oid,'EXECUTE')
           or has_function_privilege('authenticated', p.oid,'EXECUTE'))) <> 0 then
    raise exception '0030 self-check FAILED: fn_billing_apply is client-reachable.';
  end if;

  raise notice '0030 OK: 57 fn_*; plans.provider_plan_code added and left NULL on '
               'all % row(s); an unmapped code is refused by name; an event with '
               'no plan keeps the current one.', (select count(*) from plans);
end
$$;
