-- ============================================================================
-- MENU MASTER NG -- tests/035_billing_tiers_and_founders.sql
--
-- Acceptance test for 0049. Run on a database with 0049 applied.
-- Rolls everything back; writes nothing that survives.
--
-- Proves the owner decisions of 2026-09-04:
--   Costing must NOT grant Sales.  Costing + Sales must.
--   The 14-day trial includes the FULL product.  An expired trial writes nothing.
--   Exactly 100 founder slots, ever.  A forfeited slot NEVER returns to the pool.
--   Reads survive a downgrade; only writes are gated.
-- ============================================================================

begin;

create temp table t35 (n int, check_name text, verdict text, detail text) on commit drop;
create temp table fx35 (label text, acct uuid, usr uuid, biz uuid) on commit drop;

-- one account per plan shape we need to exercise
do $$
declare r record; res jsonb; u uuid; a uuid; b uuid;
begin
  for r in select * from (values
      ('costing'),('trading'),('trial'),('founding_costing'),('founding_trading'),('other')
    ) v(label) loop
    u := gen_random_uuid();
    insert into auth.users (id,email) values (u, r.label||'@t35.test');
    res := fn_create_account_and_business(r.label||' Co', r.label||' Kitchen','other', u,
             p_idempotency_key => gen_random_uuid()::text);
    a := (res->>'account_id')::uuid; b := (res->>'business_id')::uuid;
    insert into fx35 values (r.label, a, u, b);
  end loop;

  -- put each account on its plan, active and in date
  update subscriptions s set plan_id='costing',          status='active',
         current_period_end = now()+interval '30 days'
    where s.account_id = (select acct from fx35 where label='costing');
  update subscriptions s set plan_id='trading',          status='active',
         current_period_end = now()+interval '30 days'
    where s.account_id = (select acct from fx35 where label='trading');
  update subscriptions s set plan_id='founding_costing', status='active',
         current_period_end = now()+interval '30 days', founding_price_active=true
    where s.account_id = (select acct from fx35 where label='founding_costing');
  update subscriptions s set plan_id='founding_trading', status='active',
         current_period_end = now()+interval '30 days', founding_price_active=true
    where s.account_id = (select acct from fx35 where label='founding_trading');
  -- 'trial' keeps whatever onboarding gave it: plan trial, status trialing
end $$;

-- Attempt a SALES write as the account owner, and report what happened.
create or replace function pg_temp.sales_write(p_user uuid, p_account uuid, p_biz uuid, p_what text)
returns text language plpgsql as $$
declare msg text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  begin
    if p_what = 'orders' then
      insert into orders (account_id, business_id, order_no, order_date)
        values (p_account, p_biz, 't35-'||gen_random_uuid(), current_date);
    elsif p_what = 'customers' then
      insert into customers (account_id, business_id, name)
        values (p_account, p_biz, 't35-'||gen_random_uuid());
    elsif p_what = 'channels' then
      insert into channels (account_id, business_id, name)
        values (p_account, p_biz, 't35-'||gen_random_uuid());
    end if;
    msg := 'WROTE';
  exception when others then msg := sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  return msg;
end $$;

-- Attempt a COSTING write -- must stay allowed for every entitled plan.
create or replace function pg_temp.costing_write(p_user uuid, p_account uuid)
returns text language plpgsql as $$
declare msg text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  begin
    insert into ingredients (account_id, kind, name, base_unit_id)
      values (p_account,'ingredient','t35-'||gen_random_uuid(),
              (select id from units where account_id is null and code='g'));
    msg := 'WROTE';
  exception when others then msg := sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  return msg;
end $$;

create or replace function pg_temp.can_read_orders(p_user uuid, p_account uuid)
returns bigint language plpgsql as $$
declare n bigint;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  select count(*) into n from orders where account_id = p_account;
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  return n;
end $$;

do $$
declare c record; t record; tr record; fc record; ft record; o record;
        r text; n bigint; seq1 int; seq2 int; i int; filler uuid;
begin
  select * into c  from fx35 where label='costing';
  select * into t  from fx35 where label='trading';
  select * into tr from fx35 where label='trial';
  select * into fc from fx35 where label='founding_costing';
  select * into ft from fx35 where label='founding_trading';
  select * into o  from fx35 where label='other';

  -- ===================== COSTING MUST NOT GRANT SALES =====================
  r := pg_temp.sales_write(c.usr,c.acct,c.biz,'orders');
  insert into t35 values (1,'Costing cannot record a sale',
    case when r <> 'WROTE' then 'PASS' else 'FAIL' end, left(r,60));
  r := pg_temp.sales_write(c.usr,c.acct,c.biz,'customers');
  insert into t35 values (2,'Costing cannot add a customer',
    case when r <> 'WROTE' then 'PASS' else 'FAIL' end, left(r,60));
  r := pg_temp.sales_write(c.usr,c.acct,c.biz,'channels');
  insert into t35 values (3,'Costing cannot add a sales channel',
    case when r <> 'WROTE' then 'PASS' else 'FAIL' end, left(r,60));

  -- and it must still get the product it DID pay for
  r := pg_temp.costing_write(c.usr,c.acct);
  insert into t35 values (4,'Costing can still do costing work',
    case when r = 'WROTE' then 'PASS' else 'FAIL' end, left(r,60));

  -- ===================== COSTING + SALES MUST GRANT IT =====================
  r := pg_temp.sales_write(t.usr,t.acct,t.biz,'orders');
  insert into t35 values (5,'Costing + Sales can record a sale',
    case when r = 'WROTE' then 'PASS' else 'FAIL' end, left(r,60));
  r := pg_temp.sales_write(t.usr,t.acct,t.biz,'customers');
  insert into t35 values (6,'Costing + Sales can add a customer',
    case when r = 'WROTE' then 'PASS' else 'FAIL' end, left(r,60));

  -- ===================== THE TRIAL IS THE FULL PRODUCT =====================
  r := pg_temp.sales_write(tr.usr,tr.acct,tr.biz,'orders');
  insert into t35 values (7,'a live trial can record a sale (full product)',
    case when r = 'WROTE' then 'PASS' else 'FAIL' end, left(r,60));

  update subscriptions set current_period_end = now() - interval '1 day',
         trial_ends_at = now() - interval '1 day'
   where account_id = tr.acct;
  r := pg_temp.sales_write(tr.usr,tr.acct,tr.biz,'orders');
  insert into t35 values (8,'an EXPIRED trial cannot record a sale',
    case when r <> 'WROTE' then 'PASS' else 'FAIL' end, left(r,60));
  r := pg_temp.costing_write(tr.usr,tr.acct);
  insert into t35 values (9,'an EXPIRED trial cannot do costing work either',
    case when r <> 'WROTE' then 'PASS' else 'FAIL' end, left(r,60));

  -- ===================== FOUNDING PRICE, SAME ENTITLEMENTS =====================
  r := pg_temp.sales_write(fc.usr,fc.acct,fc.biz,'orders');
  insert into t35 values (10,'Founding Costing cannot record a sale',
    case when r <> 'WROTE' then 'PASS' else 'FAIL' end, left(r,60));
  r := pg_temp.sales_write(ft.usr,ft.acct,ft.biz,'orders');
  insert into t35 values (11,'Founding Costing + Sales can record a sale',
    case when r = 'WROTE' then 'PASS' else 'FAIL' end, left(r,60));

  -- ===================== DOWNGRADE KEEPS HISTORY READABLE =====================
  n := pg_temp.can_read_orders(t.usr,t.acct);
  update subscriptions set plan_id='costing' where account_id=t.acct;
  insert into t35 values (12,'a downgrade still reads its own sales history',
    case when pg_temp.can_read_orders(t.usr,t.acct) = n and n > 0 then 'PASS' else 'FAIL' end,
    n||' order(s) still visible');
  r := pg_temp.sales_write(t.usr,t.acct,t.biz,'orders');
  insert into t35 values (13,'a downgrade cannot record NEW sales',
    case when r <> 'WROTE' then 'PASS' else 'FAIL' end, left(r,60));

  -- ===================== UPGRADE TAKES EFFECT =====================
  update subscriptions set plan_id='trading' where account_id=c.acct;
  r := pg_temp.sales_write(c.usr,c.acct,c.biz,'orders');
  insert into t35 values (14,'an upgrade to Costing + Sales can record a sale',
    case when r = 'WROTE' then 'PASS' else 'FAIL' end, left(r,60));
  update subscriptions set plan_id='costing' where account_id=c.acct;

  -- ===================== DUNNING AND CANCELLATION =====================
  update subscriptions set plan_id='trading', status='past_due',
         current_period_end = now() - interval '1 day' where account_id=t.acct;
  r := pg_temp.sales_write(t.usr,t.acct,t.biz,'orders');
  insert into t35 values (15,'past_due inside grace can still record a sale',
    case when r = 'WROTE' then 'PASS' else 'FAIL' end, left(r,60));

  update subscriptions set current_period_end = now() - interval '400 days' where account_id=t.acct;
  r := pg_temp.sales_write(t.usr,t.acct,t.biz,'orders');
  insert into t35 values (16,'past_due BEYOND grace cannot record a sale',
    case when r <> 'WROTE' then 'PASS' else 'FAIL' end, left(r,60));

  update subscriptions set status='cancelled',
         current_period_end = now() + interval '5 days' where account_id=t.acct;
  r := pg_temp.sales_write(t.usr,t.acct,t.biz,'orders');
  insert into t35 values (17,'cancelled but paid-up can still record a sale',
    case when r = 'WROTE' then 'PASS' else 'FAIL' end, left(r,60));

  update subscriptions set current_period_end = now() - interval '1 day' where account_id=t.acct;
  r := pg_temp.sales_write(t.usr,t.acct,t.biz,'orders');
  insert into t35 values (18,'cancelled and past the period end cannot',
    case when r <> 'WROTE' then 'PASS' else 'FAIL' end, left(r,60));

  -- ===================== THE HUNDRED =====================
  insert into t35 values (19,'exactly 100 founder slots exist',
    case when (select count(*) from founder_slots) = 100 then 'PASS' else 'FAIL' end,
    (select count(*)::text from founder_slots)||' slot(s)');

  begin
    insert into founder_slots (seq) values (101);
    insert into t35 values (20,'a 101st slot cannot be created','FAIL','it was accepted');
  exception when others then
    insert into t35 values (20,'a 101st slot cannot be created','PASS', left(sqlerrm,60));
  end;

  seq1 := fn_claim_founder_slot(fc.acct);
  seq2 := fn_claim_founder_slot(fc.acct);
  insert into t35 values (21,'claiming twice returns the SAME slot, not two',
    case when seq1 is not null and seq1 = seq2 then 'PASS' else 'FAIL' end,
    coalesce(seq1::text,'null')||' then '||coalesce(seq2::text,'null'));

  perform fn_confirm_founder_slot(fc.acct);
  insert into t35 values (22,'a confirmed slot is claimed and no longer reserved',
    case when (select claimed_at is not null and reserved_until is null
                 from founder_slots where account_id=fc.acct) then 'PASS' else 'FAIL' end, '');

  -- Fill the rest with real accounts: founder_slots.account_id carries a
  -- foreign key to accounts, which is correct and which the first version of
  -- this test tripped over by claiming with invented uuids.
  for i in 1..120 loop
    insert into accounts (name) values ('t35 filler '||i) returning id into filler;
    perform fn_claim_founder_slot(filler);
  end loop;
  insert into t35 values (23,'no more than 100 slots can ever be held',
    case when (select count(*) from founder_slots where account_id is not null) = 100
         then 'PASS' else 'FAIL' end,
    (select count(*)::text from founder_slots where account_id is not null)||' held');
  insert into t35 values (24,'customer 101 is refused a founder slot',
    case when fn_claim_founder_slot(o.acct) is null then 'PASS' else 'FAIL' end,
    'null means fall back to standard pricing');

  -- ===================== FORFEITURE =====================
  perform fn_forfeit_founding_price(fc.acct,'lapsed in test');
  insert into t35 values (25,'a lapse forfeits the founding price',
    case when (select not founding_price_active from subscriptions where account_id=fc.acct)
         then 'PASS' else 'FAIL' end, '');
  insert into t35 values (26,'founder status is kept historically, with the date',
    case when (select forfeited_at is not null and account_id = fc.acct
                 from founder_slots where account_id=fc.acct) then 'PASS' else 'FAIL' end,
    'the slot still names the account that held it');
  insert into t35 values (27,'a forfeited slot NEVER returns to the pool',
    case when fn_claim_founder_slot(o.acct) is null then 'PASS' else 'FAIL' end,
    'customer 101 still cannot inherit it');
  insert into t35 values (28,'a forfeited founder cannot reclaim founding pricing',
    case when fn_claim_founder_slot(fc.acct) is null then 'PASS' else 'FAIL' end,
    'resubscribing gets standard pricing');

  -- ===================== NOT REACHABLE FROM THE BROWSER =====================
  insert into t35 values (29,'a signed-in user cannot allocate a founder slot',
    case when not has_function_privilege('authenticated',
           'fn_claim_founder_slot(uuid,interval)','execute') then 'PASS' else 'FAIL' end,
    'service context only');
  insert into t35 values (30,'anon cannot read the sales entitlement function',
    case when not has_function_privilege('anon','fn_account_has_sales(uuid)','execute')
         then 'PASS' else 'FAIL' end, '');

  -- ===================== PRICES ARE SERVER-SIDE FACTS =====================
  insert into t35 values (31,'the approved prices are in the database, in kobo',
    case when (select price_kobo from plans where id='costing')          = 750000
     and (select price_kobo from plans where id='trading')          = 1500000
     and (select price_kobo from plans where id='founding_costing') = 350000
     and (select price_kobo from plans where id='founding_trading') = 750000
    then 'PASS' else 'FAIL' end, 'N7,500 / N15,000 / N3,500 / N7,500');

  insert into t35 values (32,'no active paid plan is priced at zero',
    case when not exists (select 1 from plans
           where is_active and price_tier <> 'trial' and price_kobo = 0)
         then 'PASS' else 'FAIL' end, '');

  -- ===================== READS STAY UNGATED, STRUCTURALLY =====================
  insert into t35 values (33,'exactly 13 Sales WRITE policies check the tier',
    case when (select count(*) from pg_policies where schemaname='public' and cmd<>'SELECT'
                and tablename in ('orders','order_lines','customers','channels','sales_entries')
                and (coalesce(qual,'')||coalesce(with_check,'')) like '%fn_account_has_sales%') = 13
         then 'PASS' else 'FAIL' end, '');
  insert into t35 values (34,'no SELECT policy checks the tier',
    case when (select count(*) from pg_policies where schemaname='public' and cmd='SELECT'
                and tablename in ('orders','order_lines','customers','channels','sales_entries')
                and (coalesce(qual,'')||coalesce(with_check,'')) like '%fn_account_has_sales%') = 0
         then 'PASS' else 'FAIL' end, 'history survives a downgrade');
end $$;

select * from t35 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict<>'PASS') as fail from t35;

rollback;
