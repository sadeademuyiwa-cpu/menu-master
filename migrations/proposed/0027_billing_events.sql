-- ============================================================================
-- MENU MASTER NG
-- 0027: billing_events -- GATE 3, the webhook audit trail
--
-- Authority: docs/BILLING_INTEGRATION_DESIGN.md, review-approved 23 Aug.
-- Requires: 0021-0026 applied (53 fn_* / 49 relations / 105 policies).
--
-- RENUMBERED. The design calls this file `0019_billing_events.sql`. 0019c and
-- 0020 took that slot during the signup repair, and 0021-0026 are Gate 2. The
-- content is unchanged; only the number moves.
--
-- WHAT THIS IS FOR
--   Paystack signs its webhooks. PostgREST cannot verify a signature, so an
--   Edge Function must. This table is the durable record of every webhook that
--   arrives -- verified or not, applied or not -- so the question the whole
--   thing exists to answer can be answered: PAYSTACK SAYS THEY PAID. DID WE
--   ACT ON IT?
--
-- ACCESS
--   RLS enabled with NO CLIENT POLICIES. anon and authenticated can read
--   nothing and write nothing. Only service_role holds DML. Thanks to 0018 this
--   table inherits nothing at creation -- before 0018 it would have arrived
--   with ALL granted to anon, including TRUNCATE, which is an audit table an
--   unauthenticated visitor could empty.
--
-- NO SECRET IS STORED, REFERENCED OR REQUIRED BY THIS MIGRATION.
-- ============================================================================

do $$
begin
  if (select count(*) from pg_proc
       where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 53 then
    raise exception '0027 preflight FAILED: expected 53 fn_* functions, found %. '
                    'Are 0021-0026 all applied?',
      (select count(*) from pg_proc
        where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  if to_regclass('public.billing_events') is not null then
    raise exception '0027 preflight FAILED: billing_events already exists.';
  end if;
  raise notice '0027 preflight OK.';
end
$$;

-- ----------------------------------------------------------------------------
-- 1. The table, exactly as designed
-- ----------------------------------------------------------------------------
create table billing_events (
  id                 uuid primary key default gen_random_uuid(),
  received_at        timestamptz not null default now(),

  provider           text        not null default 'paystack',
  event_type         text,                       -- null when payload unparseable
  provider_event_id  text,                       -- Paystack data.id
  reference          text,                       -- Paystack data.reference
  -- on delete set null, deliberately: deleting an account must NOT erase the
  -- evidence that money moved
  account_id         uuid references accounts(id) on delete set null,

  body_sha256        text        not null,       -- exact-redelivery key
  payload            jsonb,                      -- REDACTED, see section 3
  body_bytes         integer,
  source_ip          inet,

  signature_valid    boolean     not null,
  status             text        not null default 'received',
  attempts           integer     not null default 0,
  next_retry_at      timestamptz,

  last_error_code    text,
  last_error         text,
  applied_at         timestamptz,

  constraint ck_billing_events_status check (status in (
    'received','processing','applied','ignored',
    'failed_permanent','failed_transient','rejected'))
);

-- an exact redelivery of the same bytes is the same event
create unique index ux_billing_events_body
  on billing_events (provider, body_sha256);

-- and so is a redelivery Paystack has renumbered but identified
create unique index ux_billing_events_provider_event
  on billing_events (provider, event_type, provider_event_id)
  where provider_event_id is not null;

create index ix_billing_events_pending
  on billing_events (next_retry_at)
  where status in ('received','processing','failed_transient');

create index ix_billing_events_reconcile
  on billing_events (status, event_type) where status <> 'applied';

-- ----------------------------------------------------------------------------
-- 2. RLS: enabled, with no client policy at all
--
--    Deliberate. RLS with zero policies denies every client role by default,
--    which is exactly right for an audit table. service_role bypasses RLS in
--    Supabase and is the only role granted DML below.
-- ----------------------------------------------------------------------------
alter table billing_events enable row level security;

revoke all on billing_events from anon, authenticated;
grant select, insert, update on billing_events to service_role;

-- An earlier draft of this migration CLAIMED service_role held no DELETE
-- because the grant above omits it. That was wrong, and the acceptance test
-- caught it: Supabase's DEFAULT PRIVILEGES give service_role
-- arwdDxtm -- ALL, including DELETE and TRUNCATE -- on every table created in
-- this schema. 0018 revoked those defaults for anon and authenticated only;
-- service_role keeps them by design, because it is the trusted backend role.
--
-- For an audit trail that default is worth narrowing. The webhook only ever
-- INSERTs and UPDATEs, so removing DELETE and TRUNCATE costs it nothing and
-- turns a stray `delete from billing_events` into an error instead of a silent
-- loss of the evidence that money moved. This is deliberate hardening BEYOND
-- what the design specifies; the design says only that service_role holds DML.
revoke delete, truncate on billing_events from service_role;

-- ----------------------------------------------------------------------------
-- 3. Redaction, enforced by the database
--
--    Design section 7: data.authorization.authorization_code is a BEARER
--    CREDENTIAL -- it lets the holder charge that customer again without their
--    involvement. It must never be stored.
--
--    The design has the Edge Function strip it before writing. This trigger
--    strips it again on the way in, so the guarantee does not depend on the
--    function remembering. Defence in depth over a convention, for the one
--    field the design calls the single most important line in the document.
--
--    Retained: last4, card_type, bank, channel -- enough to identify a payment
--    method in a support conversation, not enough to use one.
-- ----------------------------------------------------------------------------
create or replace function fn_redact_billing_payload()
returns trigger language plpgsql as $$
begin
  if new.payload is null then
    return new;
  end if;
  if new.payload #> '{data,authorization}' is not null then
    new.payload := new.payload
      #- '{data,authorization,authorization_code}'
      #- '{data,authorization,signature}'
      #- '{data,authorization,bin}'
      #- '{data,authorization,exp_month}'
      #- '{data,authorization,exp_year}';
  end if;
  return new;
end;
$$;

revoke execute on function fn_redact_billing_payload() from public, anon, authenticated;

create trigger trg_billing_events_redact
  before insert or update on billing_events
  for each row execute function fn_redact_billing_payload();

-- ----------------------------------------------------------------------------
-- 4. Reconciliation
--
--    Anything visible here is money that moved without a matching entitlement
--    change. A VIEW IS NOT AN ALERT -- whatever runs the sweeper must notify a
--    human when a failed_permanent row appears.
-- ----------------------------------------------------------------------------
create view v_billing_reconciliation as
select received_at, event_type, reference, provider_event_id,
       account_id, status, last_error_code, last_error, attempts
from billing_events
where status in ('failed_permanent','failed_transient')
   or (status = 'received'   and received_at < now() - interval '15 minutes')
   or (status = 'processing' and received_at < now() - interval '15 minutes')
order by received_at desc;

revoke all on v_billing_reconciliation from anon, authenticated;
grant select on v_billing_reconciliation to service_role;

-- ----------------------------------------------------------------------------
-- 5. SELF-CHECK
-- ----------------------------------------------------------------------------
do $$
declare v_fns int; v_rels int; v_pols int; v_anon int; v_probe jsonb;
begin
  select count(*) into v_fns from pg_proc
   where pronamespace='public'::regnamespace and proname like 'fn\_%';
  select count(*) into v_rels from pg_class
   where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f');
  select count(*) into v_pols from pg_policies where schemaname='public';

  if v_fns <> 54 then
    raise exception '0027 self-check FAILED: fn_* is %, expected 54.', v_fns;
  end if;
  if v_rels <> 51 then
    raise exception '0027 self-check FAILED: relations is %, expected 51.', v_rels;
  end if;
  if v_pols <> 105 then
    raise exception '0027 self-check FAILED: policies is %, expected 105. '
                    'billing_events must have NO client policy.', v_pols;
  end if;

  if not (select relrowsecurity from pg_class where relname='billing_events') then
    raise exception '0027 self-check FAILED: RLS is not enabled on billing_events.';
  end if;
  if (select count(*) from pg_policies
       where schemaname='public' and tablename='billing_events') <> 0 then
    raise exception '0027 self-check FAILED: billing_events has a client policy.';
  end if;

  select count(*) into v_anon from information_schema.role_table_grants
   where table_schema='public'
     and table_name in ('billing_events','v_billing_reconciliation')
     and grantee in ('anon','authenticated');
  if v_anon <> 0 then
    raise exception '0027 self-check FAILED: % client grant(s) on the billing '
                    'tables. anon and authenticated must hold nothing.', v_anon;
  end if;

  select count(distinct table_name) into v_anon
    from information_schema.role_table_grants
   where grantee='anon' and table_schema='public';
  if v_anon <> 5 then
    raise exception '0027 self-check FAILED: anon reads % table(s), expected 5.', v_anon;
  end if;

  -- prove the redaction actually strips, rather than trusting the trigger exists
  insert into billing_events (body_sha256, signature_valid, payload)
  values ('selfcheck-probe', false, jsonb_build_object(
            'data', jsonb_build_object('authorization', jsonb_build_object(
              'authorization_code','AUTH_must_not_persist',
              'signature','SIG_must_not_persist',
              'bin','408408','exp_month','12','exp_year','2030',
              'last4','4081','card_type','visa'))))
  returning payload into v_probe;

  if v_probe #>> '{data,authorization,authorization_code}' is not null
     or v_probe #>> '{data,authorization,signature}' is not null
     or v_probe #>> '{data,authorization,bin}' is not null then
    raise exception '0027 self-check FAILED: a bearer credential survived '
                    'redaction. This is the one thing that must never happen.';
  end if;
  if v_probe #>> '{data,authorization,last4}' is null then
    raise exception '0027 self-check FAILED: redaction stripped last4, which '
                    'support needs.';
  end if;
  delete from billing_events where body_sha256 = 'selfcheck-probe';

  -- No NON-OWNER role may delete or truncate the audit trail. The owner is
  -- excluded because ownership carries every privilege inherently and can
  -- always re-grant; excluding it is honest, not a loophole being waved through.
  if exists (select 1 from information_schema.role_table_grants g
              where g.table_schema='public' and g.table_name='billing_events'
                and g.privilege_type in ('DELETE','TRUNCATE')
                and g.grantee <> (select pg_get_userbyid(relowner) from pg_class
                                   where relname='billing_events'
                                     and relnamespace='public'::regnamespace)) then
    raise exception '0027 self-check FAILED: a non-owner role can DELETE or '
                    'TRUNCATE the billing audit trail: %',
      (select string_agg(distinct g.grantee, ', ')
         from information_schema.role_table_grants g
        where g.table_schema='public' and g.table_name='billing_events'
          and g.privilege_type in ('DELETE','TRUNCATE')
          and g.grantee <> (select pg_get_userbyid(relowner) from pg_class
                             where relname='billing_events'
                               and relnamespace='public'::regnamespace));
  end if;

  raise notice '0027 OK: 54 fn_* / 51 relations / 105 policies. billing_events '
               'has RLS on and zero client policies; anon and authenticated hold '
               'nothing; redaction verified to strip the authorization code and '
               'keep last4.';
end
$$;
