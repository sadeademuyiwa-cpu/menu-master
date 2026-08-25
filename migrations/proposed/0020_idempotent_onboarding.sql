-- ============================================================================
-- MENU MASTER NG — 0020: idempotent onboarding (C10)
--
-- PROPOSED. Not applied. Requires explicit approval.
-- RUN INSIDE:  begin;  <this file>  commit;
--
-- THE DEFECT
--   fn_create_account_and_business is safe on failure but not idempotent on
--   success. A second successful call provisions a second account, business,
--   membership, trial and 180 more ingredients. A double-click, or a client
--   retry after a timeout where the server actually committed, silently
--   duplicates the tenant.
--
-- THE GUARANTEE
--   primary key (user_id, idempotency_key) on onboarding_requests. Not
--   application logic, not a convention: a database constraint no client can
--   bypass. An advisory lock is layered on top so the loser of a race replays
--   cleanly instead of receiving a raw 23505, but the constraint alone is
--   sufficient for correctness.
--
-- APPROVED CONTRACT
--   same key + same payload      -> replay, provisioning nothing
--   same key + different payload -> refuse, 23505
--   different key, no account    -> create account + business
--   different key, one account   -> business INSIDE that account:
--                                   no account, no membership, no subscription,
--                                   no starter-catalogue re-clone
--   different key, many accounts -> refuse as ambiguous, never guess
--   null/blank key               -> refuse, 22023
--   rolled back                  -> key row rolls back too; safely retryable
--   keys                         -> permanent, cascade only
-- ============================================================================

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname = 'fn_create_account_and_business';

  if v_def is null then
    raise exception '0020 preflight FAILED: fn_create_account_and_business is absent.';
  end if;

  -- Exact baseline. Production computed this md5 itself; the definition was
  -- reproduced byte-for-byte and verified against it before this was written.
  if md5(v_def) <> '71aff1dbc2e89d11383d77e1cbf1f967' then
    raise exception '0020 preflight FAILED: RPC fingerprint is %, expected '
                    '71aff1dbc2e89d11383d77e1cbf1f967. The function changed '
                    'since capture. STOP and re-capture.', md5(v_def);
  end if;

  if (select count(*) from pg_proc
       where pronamespace='public'::regnamespace
         and proname='fn_create_account_and_business') <> 1 then
    raise exception '0020 preflight FAILED: expected exactly one overload.';
  end if;

  if exists (select 1 from pg_class where relname = 'onboarding_requests') then
    raise exception '0020 preflight FAILED: onboarding_requests already exists.';
  end if;

  if not exists (select 1 from pg_class where relname = 'ux_subscriptions_account') then
    raise exception '0020 preflight FAILED: ux_subscriptions_account is missing.';
  end if;

  if not exists (select 1 from pg_proc where pronamespace='public'::regnamespace
                   and proname='fn_clone_starter_catalog') then
    raise exception '0020 preflight FAILED: fn_clone_starter_catalog is missing.';
  end if;

  raise notice '0020 preflight OK. Baseline fingerprint %.', md5(v_def);
end
$$;

-- ----------------------------------------------------------------------------
-- 1. THE IDEMPOTENCY LEDGER
-- ----------------------------------------------------------------------------

create table onboarding_requests (
  user_id             uuid    not null references auth.users(id) on delete cascade,
  idempotency_key     text    not null,
  payload_fingerprint text    not null,
  account_id          uuid    not null references accounts(id)   on delete cascade,
  business_id         uuid    not null references businesses(id) on delete cascade,
  location_id         uuid    not null,
  ingredients_added   integer not null,
  account_created     boolean not null,
  created_at          timestamptz not null default now(),
  constraint pk_onboarding_requests primary key (user_id, idempotency_key),
  constraint ck_onboarding_key_nonblank check (btrim(idempotency_key) <> '')
);

comment on table onboarding_requests is
  'C10 idempotency ledger. One row per successful onboarding request. The '
  'primary key (user_id, idempotency_key) is what makes onboarding safe to '
  'retry. Rows are permanent and removed only by cascade.';

alter table onboarding_requests enable row level security;

-- Scoped to authenticated deliberately: an unscoped policy would be evaluated
-- in anon sessions too, which is the collision 0018 section 7 had to repair.
create policy p_onboarding_requests on onboarding_requests
  for select to authenticated
  using (user_id = auth.uid());

-- SELECT only. The function writes as SECURITY DEFINER; clients never insert.
grant select on onboarding_requests to authenticated;
grant all    on onboarding_requests to service_role;
-- anon: nothing. Deliberately no grant of any kind.

-- ----------------------------------------------------------------------------
-- 2. REPLACE THE RPC
--
-- The two new parameters are trailing and defaulted, so an existing PostgREST
-- body still resolves. The old overload is dropped in the same transaction so
-- exactly one signature survives -- two would let PostgREST resolve
-- ambiguously by body keys.
-- ----------------------------------------------------------------------------

drop function public.fn_create_account_and_business(
  text, text, business_type, uuid, text, text, integer);

create function public.fn_create_account_and_business(
  p_account_name    text,
  p_business_name   text,
  p_business_type   business_type default 'other'::business_type,
  p_user_id         uuid          default auth.uid(),
  p_currency        text          default 'NGN'::text,
  p_plan_id         text          default 'trial'::text,
  p_trial_days      integer       default 14,
  p_idempotency_key text          default null,
  p_account_id      uuid          default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account uuid; v_business uuid; v_location uuid; v_slug text;
  v_cloned integer := 0; v_user uuid;
  v_fp text; v_row onboarding_requests%rowtype;
  v_owned_accounts uuid[]; v_account_created boolean := false;
begin
  -- ---- authorization: unchanged from the pre-C10 function --------------
  if fn_is_service_context() then
    v_user := coalesce(p_user_id, auth.uid());
  else
    v_user := auth.uid();
    if p_user_id is not null and p_user_id <> v_user then
      raise exception 'You may only create an account for yourself'
        using errcode = '42501';
    end if;
  end if;

  if v_user is null then
    raise exception 'A user is required to own the account';
  end if;
  if not exists (select 1 from auth.users where id = v_user) then
    raise exception 'User % does not exist', v_user;
  end if;
  if coalesce(btrim(p_account_name),'') = '' or coalesce(btrim(p_business_name),'') = '' then
    raise exception 'Account name and business name are required';
  end if;

  -- ---- C10: the key is mandatory in effect ------------------------------
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'An idempotency key is required for onboarding. Generate '
                    'one per onboarding attempt and reuse it for every retry.'
      using errcode = '22023';
  end if;

  -- ---- canonical payload fingerprint ------------------------------------
  -- jsonb, not json: jsonb normalises key order, so the text form is canonical
  -- and cannot depend on how the caller ordered anything. Every input that can
  -- change the provisioning outcome is included.
  v_fp := md5(jsonb_build_object(
            'account_name',  btrim(p_account_name),
            'business_name', btrim(p_business_name),
            'business_type', p_business_type::text,
            'currency',      upper(btrim(coalesce(p_currency, 'NGN'))),
            'plan_id',       btrim(coalesce(p_plan_id, 'trial')),
            'trial_days',    coalesce(p_trial_days, 14),
            'account_id',    coalesce(p_account_id::text, '')
          )::text);

  -- ---- serialise concurrent onboarding for this one user ----------------
  -- Not the guarantee -- the primary key is. This only stops the loser of a
  -- race doing ~180 inserts it will immediately discard.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  -- ---- replay ------------------------------------------------------------
  select * into v_row from onboarding_requests
   where user_id = v_user and idempotency_key = p_idempotency_key;

  if found then
    if v_row.payload_fingerprint <> v_fp then
      raise exception 'Idempotency key % was already used with a different '
                      'payload. Use a new key to create something different.',
                      p_idempotency_key
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'account_id',            v_row.account_id,
      'business_id',           v_row.business_id,
      'location_id',           v_row.location_id,
      'ingredients_added',     v_row.ingredients_added,
      'account_created',       v_row.account_created,
      'idempotent_replay',     true,
      'originally_created_at', v_row.created_at,
      'next_step',             case when exists (
                                      select 1 from ingredient_prices ip
                                       where ip.account_id = v_row.account_id)
                                    then 'continue' else 'enter_your_own_prices' end);
  end if;

  -- ---- resolve the account ----------------------------------------------
  select array_agg(distinct m.account_id) into v_owned_accounts
    from memberships m
   where m.user_id = v_user and m.role = 'owner';

  if p_account_id is not null then
    if not (p_account_id = any(coalesce(v_owned_accounts, array[]::uuid[]))) then
      raise exception 'You do not own account %, so you cannot add a business '
                      'to it.', p_account_id using errcode = '42501';
    end if;
    v_account := p_account_id;
  elsif v_owned_accounts is null or array_length(v_owned_accounts, 1) is null then
    v_account := null;                                   -- first onboarding
  elsif array_length(v_owned_accounts, 1) = 1 then
    v_account := v_owned_accounts[1];                    -- the one account
  else
    raise exception 'You own % accounts, so which one this business belongs to '
                    'is ambiguous. Pass p_account_id explicitly.',
                    array_length(v_owned_accounts, 1)
      using errcode = '21000';
  end if;

  begin
    -- ---- first onboarding: account, membership, catalogue, trial --------
    if v_account is null then
      insert into accounts (name) values (btrim(p_account_name))
        returning id into v_account;

      insert into memberships (account_id, business_id, user_id, role)
      values (v_account, null, v_user, 'owner');

      v_account_created := true;
    end if;

    v_slug := btrim(regexp_replace(lower(btrim(p_business_name)),
                                   '[^a-z0-9]+', '-', 'g'), '-');
    insert into businesses (account_id, name, slug, type)
    values (v_account, btrim(p_business_name), v_slug, p_business_type)
    returning id into v_business;

    insert into locations (account_id, business_id, name, is_default)
    values (v_account, v_business, 'Main', true) returning id into v_location;

    insert into business_settings (business_id, account_id, currency)
    values (v_business, v_account, p_currency);

    insert into channels (account_id, business_id, name, is_default)
    values (v_account, v_business, 'Direct', true);

    -- The starter catalogue and the trial belong to the ACCOUNT, not the
    -- business, so a second business under an existing account gets neither.
    if v_account_created then
      v_cloned := fn_clone_starter_catalog(v_account, p_business_type);

      insert into subscriptions (account_id, plan_id, status,
                                 trial_ends_at, current_period_end)
      values (v_account, p_plan_id, 'trialing',
              now() + (p_trial_days || ' days')::interval,
              now() + (p_trial_days || ' days')::interval);
    end if;

    insert into onboarding_requests (
      user_id, idempotency_key, payload_fingerprint,
      account_id, business_id, location_id, ingredients_added, account_created)
    values (v_user, p_idempotency_key, v_fp,
            v_account, v_business, v_location, v_cloned, v_account_created);

  exception when unique_violation then
    -- A concurrent caller won the race. Everything above, including all
    -- provisioning, is rolled back with this block. Re-read and replay.
    -- This handler must never fall through to continue provisioning.
    select * into v_row from onboarding_requests
     where user_id = v_user and idempotency_key = p_idempotency_key;

    if not found then
      raise;    -- a different unique violation: surface it, do not mask it
    end if;

    return jsonb_build_object(
      'account_id',            v_row.account_id,
      'business_id',           v_row.business_id,
      'location_id',           v_row.location_id,
      'ingredients_added',     v_row.ingredients_added,
      'account_created',       v_row.account_created,
      'idempotent_replay',     true,
      'originally_created_at', v_row.created_at,
      'next_step',             'enter_your_own_prices');
  end;

  return jsonb_build_object(
    'account_id', v_account, 'business_id', v_business, 'location_id', v_location,
    'ingredients_added', v_cloned, 'account_created', v_account_created,
    'idempotent_replay', false, 'next_step', 'enter_your_own_prices');
end;
$function$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, and anon inherits from
-- PUBLIC. Without this revoke the new function would be callable by anon --
-- precisely the hole 0018 exists to close, reopened by creating a function.
-- ALTER DEFAULT PRIVILEGES does not help here: it governs grants to named
-- roles, not the implicit PUBLIC grant. Revoke first, then grant.
revoke all on function public.fn_create_account_and_business(
  text, text, business_type, uuid, text, text, integer, text, uuid)
  from public, anon;

-- Re-grant exactly what the captured baseline held: authenticated and
-- service_role. anon held none and gains none.
grant execute on function public.fn_create_account_and_business(
  text, text, business_type, uuid, text, text, integer, text, uuid)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. SELF-CHECK
-- ----------------------------------------------------------------------------

do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_proc
   where pronamespace='public'::regnamespace
     and proname='fn_create_account_and_business';
  if v_n <> 1 then
    raise exception '0020 self-check FAILED: % overloads survive, expected 1. '
                    'PostgREST would resolve ambiguously.', v_n;
  end if;

  if not has_function_privilege('authenticated',
       'public.fn_create_account_and_business(text,text,business_type,uuid,text,text,integer,text,uuid)',
       'EXECUTE') then
    raise exception '0020 self-check FAILED: authenticated lost EXECUTE.';
  end if;

  if has_function_privilege('anon',
       'public.fn_create_account_and_business(text,text,business_type,uuid,text,text,integer,text,uuid)',
       'EXECUTE') then
    raise exception '0020 self-check FAILED: anon gained EXECUTE.';
  end if;

  if exists (select 1 from information_schema.role_table_grants
              where table_schema='public' and table_name='onboarding_requests'
                and grantee='anon') then
    raise exception '0020 self-check FAILED: anon holds a grant on onboarding_requests.';
  end if;

  if (select count(*) from information_schema.role_table_grants
       where table_schema='public' and table_name='onboarding_requests'
         and grantee='authenticated' and privilege_type <> 'SELECT') > 0 then
    raise exception '0020 self-check FAILED: authenticated holds more than SELECT '
                    'on onboarding_requests.';
  end if;

  if (select count(*) from pg_class
       where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f')) <> 44 then
    raise exception '0020 self-check FAILED: expected 44 public relations.';
  end if;

  if (select count(*) from pg_policies where schemaname='public') <> 93 then
    raise exception '0020 self-check FAILED: expected 93 policies.';
  end if;

  raise notice '0020 OK: onboarding is idempotent. One overload, 44 relations, '
               '93 policies, anon excluded.';
end
$$;
