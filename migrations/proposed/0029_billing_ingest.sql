-- ============================================================================
-- MENU MASTER NG
-- 0029: billing ingest and apply -- GATE 3, the database side of the webhook
--
-- Authority: docs/BILLING_INTEGRATION_DESIGN.md sections 2, 3, 4 and 8.
-- Requires: 0021-0028 applied (55 fn_* / 51 relations / 105 policies).
--
-- WHY THESE LIVE IN THE DATABASE
--   Design section 4 steps 7-11 are: insert, claim, map, apply, record. Doing
--   them as four round trips from the Edge Function leaves windows in which
--   money has moved and our record of it has not. Each function here is one
--   transaction, so a crash between steps cannot leave a half-applied event.
--
--   The Edge Function keeps what only it can do: read the RAW bytes, verify the
--   HMAC in constant time, and decide the HTTP status. Neither secret is known
--   to the database and none is stored here.
--
-- ACCESS: service_role only. anon and authenticated get nothing.
-- ============================================================================

do $$
begin
  if (select count(*) from pg_proc
       where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 55 then
    raise exception '0029 preflight FAILED: expected 55 fn_* functions, found %.',
      (select count(*) from pg_proc
        where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  if to_regclass('public.billing_events') is null then
    raise exception '0029 preflight FAILED: 0027 is not applied.';
  end if;
  raise notice '0029 preflight OK.';
end
$$;

-- ----------------------------------------------------------------------------
-- 1. Steps 7 and 8 -- record, then claim
--
--    Returns the event id and what the caller should do next. Both idempotency
--    layers live here: exact-bytes (body_sha256) and provider event id.
--
--    action:
--      'process'   fresh event, claimed, go on to apply it
--      'duplicate' already seen; existing status is returned for the log
--      'lost_race' another worker holds the claim; return 200 and stop
-- ----------------------------------------------------------------------------
create or replace function fn_billing_ingest(
  p_body_sha256      text,
  p_signature_valid  boolean,
  p_event_type       text    default null,
  p_provider_event_id text   default null,
  p_reference        text    default null,
  p_payload          jsonb   default null,
  p_body_bytes       integer default null,
  p_source_ip        inet    default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_status text; v_claimed int;
begin
  if not fn_is_service_context() then
    raise exception 'fn_billing_ingest is a service-context function'
      using errcode = '42501';
  end if;

  -- A rejected signature is recorded as a MINIMAL row and goes no further.
  -- Never the body: it is attacker-controlled and the endpoint is guessable.
  if not p_signature_valid then
    insert into billing_events (body_sha256, signature_valid, status,
                                body_bytes, source_ip)
    values (p_body_sha256, false, 'rejected', p_body_bytes, p_source_ip)
    on conflict (provider, body_sha256) do nothing
    returning id into v_id;
    return jsonb_build_object('action','rejected','event_id',v_id);
  end if;

  begin
    insert into billing_events (body_sha256, signature_valid, event_type,
                                provider_event_id, reference, payload,
                                body_bytes, source_ip, status)
    values (p_body_sha256, true, p_event_type, p_provider_event_id, p_reference,
            p_payload, p_body_bytes, p_source_ip, 'received')
    returning id into v_id;
  exception when unique_violation then
    -- layer 1 or layer 2 caught a redelivery
    select id, status into v_id, v_status from billing_events
     where (provider, body_sha256) = ('paystack', p_body_sha256)
        or (provider_event_id is not null
            and (provider, event_type, provider_event_id)
                = ('paystack', p_event_type, p_provider_event_id))
     limit 1;
    return jsonb_build_object('action','duplicate','event_id',v_id,
                              'existing_status',v_status);
  end;

  -- claim it: only one worker may move a row out of 'received'
  update billing_events
     set status = 'processing', attempts = attempts + 1
   where id = v_id and status = 'received';
  get diagnostics v_claimed = row_count;

  if v_claimed = 0 then
    return jsonb_build_object('action','lost_race','event_id',v_id);
  end if;
  return jsonb_build_object('action','process','event_id',v_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Steps 9 to 11 -- map, apply, record
--
--    The Paystack vocabulary is mapped HERE and never persisted: subscriptions
--    .status only ever holds one of the four internal values, enforced by the
--    0017 CHECK constraint. Every write goes through fn_set_subscription_plan;
--    this function never issues UPDATE subscriptions directly, because 0012
--    revoked that from clients and 0017 added the guards, and bypassing them
--    would discard exactly the protections Gate 1 verified.
-- ----------------------------------------------------------------------------
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

revoke execute on function fn_billing_ingest(text,boolean,text,text,text,jsonb,integer,inet)
  from public, anon, authenticated;
revoke execute on function fn_billing_apply(uuid) from public, anon, authenticated;
grant  execute on function fn_billing_ingest(text,boolean,text,text,text,jsonb,integer,inet)
  to service_role;
grant  execute on function fn_billing_apply(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 3. SELF-CHECK
-- ----------------------------------------------------------------------------
do $$
declare v_fns int; v_bad int;
begin
  select count(*) into v_fns from pg_proc
   where pronamespace='public'::regnamespace and proname like 'fn\_%';
  if v_fns <> 57 then
    raise exception '0029 self-check FAILED: fn_* is %, expected 57.', v_fns;
  end if;

  select count(*) into v_bad from pg_proc p
   where p.proname in ('fn_billing_ingest','fn_billing_apply')
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_bad > 0 then
    raise exception '0029 self-check FAILED: % billing function(s) reachable by '
                    'a client role.', v_bad;
  end if;

  -- neither function may write subscriptions directly
  if exists (select 1 from pg_proc
              where proname in ('fn_billing_ingest','fn_billing_apply')
                and prosrc ~* 'update[[:space:]]+subscriptions') then
    raise exception '0029 self-check FAILED: a billing function writes '
                    'subscriptions directly instead of going through '
                    'fn_set_subscription_plan.';
  end if;

  if (select count(*) from pg_policies where schemaname='public') <> 105 then
    raise exception '0029 self-check FAILED: policy count moved.';
  end if;

  raise notice '0029 OK: 57 fn_*; ingest and apply are service-context only, '
               'unreachable by anon or authenticated, and every subscription '
               'write still goes through fn_set_subscription_plan.';
end
$$;
