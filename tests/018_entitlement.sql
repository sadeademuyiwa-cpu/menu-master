-- ============================================================================
-- MENU MASTER NG -- tests/018_entitlement.sql
--
-- Acceptance test for 0028 (C4 -- server-side entitlement enforcement).
-- Run on a database with 0021-0028 applied. Rolls everything back.
--
-- Proves the rule from SUBSCRIPTION_STATE_MACHINE.md section 1, and proves the
-- owner ruling: writes are gated, READS ARE NOT.
-- ============================================================================

begin;

create temp table t9 (n int, check_name text, verdict text, detail text) on commit drop;
create temp table t9_fx (acct uuid, usr uuid, biz uuid, ing uuid, other_acct uuid, other_usr uuid)
  on commit drop;

do $$
declare
  a uuid; u uuid := gen_random_uuid(); b uuid;
  a2 uuid; u2 uuid := gen_random_uuid(); b2 uuid;
  ing uuid := gen_random_uuid(); u_g uuid; res jsonb;
begin
  select id into u_g from units where account_id is null and code='g';
  insert into auth.users (id,email) values (u,'ent@t.test'), (u2,'ent2@t.test');

  res := fn_create_account_and_business('Ent Co','Ent Kitchen','soup_seller', u,
           p_idempotency_key => gen_random_uuid()::text);
  a := (res->>'account_id')::uuid;  b := (res->>'business_id')::uuid;
  res := fn_create_account_and_business('Other Co','Other Kitchen','restaurant', u2,
           p_idempotency_key => gen_random_uuid()::text);
  a2 := (res->>'account_id')::uuid; b2 := (res->>'business_id')::uuid;

  insert into ingredients (id,account_id,kind,name,base_unit_id)
    values (ing,a,'ingredient','Existing Rice',u_g);
  insert into t9_fx values (a,u,b,ing,a2,u2);
end
$$;

-- helper: attempt a write as the account's owner and report what happened
create or replace function pg_temp.try_write(p_user uuid, p_account uuid, p_label text)
returns text language plpgsql as $$
declare msg text; n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  begin
    insert into ingredients (account_id, kind, name, base_unit_id)
      values (p_account, 'ingredient', p_label,
              (select id from units where account_id is null and code='g'));
    msg := 'WROTE';
  exception when others then msg := sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  return msg;
end;
$$;

do $$
declare f record; r text; n int; ent boolean;
begin
  select * into f from t9_fx;

  -- ============================================ 1. the entitled states
  update subscriptions set status='trialing' where account_id=f.acct;
  insert into t9 values (1,'trialing can write',
    case when pg_temp.try_write(f.usr,f.acct,'w-trialing')='WROTE' then 'PASS' else 'FAIL' end,
    left(pg_temp.try_write(f.usr,f.acct,'w-trialing-2'),50));

  update subscriptions set status='active' where account_id=f.acct;
  insert into t9 values (2,'active can write',
    case when pg_temp.try_write(f.usr,f.acct,'w-active')='WROTE' then 'PASS' else 'FAIL' end,
    'grace not needed');

  update subscriptions set status='past_due' where account_id=f.acct;
  insert into t9 values (3,'past_due can still write (dunning is a grace period)',
    case when pg_temp.try_write(f.usr,f.acct,'w-pastdue')='WROTE' then 'PASS' else 'FAIL' end,
    'a failed card must not lock an owner out the same afternoon');

  update subscriptions set status='cancelled', current_period_end = now() + interval '10 days'
   where account_id=f.acct;
  insert into t9 values (4,'cancelled but still inside the paid period can write',
    case when pg_temp.try_write(f.usr,f.acct,'w-cancelled-future')='WROTE' then 'PASS' else 'FAIL' end,
    'a customer who cancels on day 3 keeps what they paid for');

  -- ============================================ 2. the unentitled states
  update subscriptions set status='cancelled', current_period_end = now() - interval '1 day'
   where account_id=f.acct;
  r := pg_temp.try_write(f.usr,f.acct,'w-cancelled-expired');
  insert into t9 values (5,'cancelled AND the period has ended cannot write',
    case when r<>'WROTE' then 'PASS' else 'FAIL' end, left(r,52));

  select fn_account_is_entitled(f.acct) into ent;
  insert into t9 values (6,'and the predicate says so directly',
    case when ent = false then 'PASS' else 'FAIL' end, 'entitled = '||ent::text);

  -- ============================================ 3. READS SURVIVE (the D2 ruling)
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', f.usr::text, true);
  select count(*) into n from ingredients where account_id=f.acct;
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  insert into t9 values (7,'an UNENTITLED account can still READ its own data',
    case when n > 0 then 'PASS' else 'FAIL' end,
    'saw '||n||' ingredient(s) — their data is theirs');

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', f.usr::text, true);
  select count(*) into n from v_price_check where account_id=f.acct;
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  insert into t9 values (8,'and can still read its costing views',
    case when n >= 0 then 'PASS' else 'FAIL' end, 'no error raised');

  -- ============================================ 4. the owner is not stranded
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', f.usr::text, true);
  begin
    insert into memberships (account_id, business_id, user_id, role)
      values (f.acct, f.biz, f.other_usr, 'manager');
    r := 'WROTE';
  exception when others then r := sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  insert into t9 values (9,'an unentitled owner can still add a member',
    case when r='WROTE' then 'PASS' else 'FAIL' end,
    left(r,52)||' — needed to sort the billing out');

  -- ============================================ 5. entitlement is per account
  r := pg_temp.try_write(f.other_usr, f.other_acct, 'w-other');
  insert into t9 values (10,'one account lapsing does not affect another',
    case when r='WROTE' then 'PASS' else 'FAIL' end, left(r,52));

  -- ============================================ 6. restoring the subscription restores writing
  update subscriptions set status='active' where account_id=f.acct;
  r := pg_temp.try_write(f.usr,f.acct,'w-reactivated');
  insert into t9 values (11,'paying again restores writing immediately',
    case when r='WROTE' then 'PASS' else 'FAIL' end, left(r,52));
end
$$;

-- ============================================ 7. shape and grants
do $$
declare n int;
begin
  select count(*) into n from pg_policies where schemaname='public' and cmd='SELECT'
    and coalesce(qual,'')||coalesce(with_check,'') like '%fn_account_is_entitled%';
  insert into t9 values (12,'no SELECT policy is gated by entitlement',
    case when n=0 then 'PASS' else 'FAIL' end, n||' gated read policy(ies)');

  select count(*) into n from pg_policies where schemaname='public'
    and coalesce(qual,'')||coalesce(with_check,'') like '%fn_account_is_entitled%';
  insert into t9 values (13,'60 write policies carry the gate',
    case when n=60 then 'PASS' else 'FAIL' end, n||' policy(ies)');

  select count(*) into n from pg_policies where schemaname='public';
  insert into t9 values (14,'the policy count did not move',
    case when n=105 then 'PASS' else 'FAIL' end, n::text);

  select count(*) into n from pg_proc p where p.proname='fn_account_is_entitled'
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  insert into t9 values (15,'anon cannot call the entitlement predicate',
    case when n=0 then 'PASS' else 'FAIL' end, n||' grant(s)');
end
$$;

select n, check_name, verdict, left(detail,56) as detail from t9 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t9;

rollback;
