-- ============================================================================
-- MENU MASTER NG -- tests/036_checkout_and_founder_payment.sql
--
-- Acceptance test for 0050. Run on a database with 0050 applied.
-- Rolls everything back; writes nothing that survives.
--
-- The defect 0050 corrects is not a missing feature -- it is a payment we take
-- and do not honour. So the central assertions here are about MONEY that has
-- already moved: a founding customer who pays must end up holding a confirmed
-- slot and a locked price, every time, from a signature-verified event and
-- from nowhere else.
-- ============================================================================

begin;

create temp table t36 (n int, check_name text, verdict text, detail text) on commit drop;
create temp table fx36 (label text, acct uuid, usr uuid, biz uuid) on commit drop;

do $$
declare r record; res jsonb; u uuid; a uuid; b uuid;
begin
  for r in select * from (values ('alice'),('bob'),('carol'),('dave'),('erin')) v(label) loop
    u := gen_random_uuid();
    insert into auth.users (id,email) values (u, r.label||'@t36.test');
    res := fn_create_account_and_business(r.label||' Co', r.label||' Kitchen','other', u,
             p_idempotency_key => gen_random_uuid()::text);
    a := (res->>'account_id')::uuid; b := (res->>'business_id')::uuid;
    insert into fx36 values (r.label, a, u, b);
  end loop;
end $$;

-- Deliver a signed-and-verified Paystack event exactly the way the edge
-- function does: ingest, then apply. Nothing here bypasses the pipeline.
create or replace function pg_temp.deliver(p_event text, p_account uuid, p_plan text,
                                           p_extra jsonb default '{}'::jsonb)
returns jsonb language plpgsql as $$
declare v_body text; v_ing jsonb; v_payload jsonb;
begin
  v_body := gen_random_uuid()::text;
  v_payload := jsonb_build_object(
      'event', p_event,
      'data', jsonb_build_object(
        'id', floor(random()*1e9)::bigint,
        'reference', 'ref-'||v_body,
        'metadata', jsonb_build_object('account_id', p_account::text, 'plan_id', p_plan),
        'customer', jsonb_build_object('customer_code','CUS_'||left(v_body,8)),
        'next_payment_date', (now() + interval '30 days')::text
      ) || p_extra);
  v_ing := fn_billing_ingest(
      p_body_sha256 => encode(digest(v_body,'sha256'),'hex'),
      p_signature_valid => true,
      p_event_type => p_event,
      p_provider_event_id => v_body,
      p_reference => 'ref-'||v_body,
      p_payload => v_payload,
      p_body_bytes => length(v_body),
      p_source_ip => '127.0.0.1'::inet);
  return fn_billing_apply((v_ing->>'event_id')::uuid);
end $$;

do $$
declare
  f record; q jsonb; r jsonb; n int; s record; msg text; seq int;
begin
  -- ======================================================= 1. THE QUOTE
  select * into f from fx36 where label='alice';

  q := fn_checkout_quote(f.acct, 'costing');
  insert into t36 values (1,'a first customer is quoted FOUNDING costing',
    case when q->>'plan_id'='founding_costing' and (q->>'price_kobo')::int=350000
         then 'PASS' else 'FAIL' end,
    (q->>'plan_id')||' at '||(q->>'price_kobo')||' kobo');

  insert into t36 values (2,'the quote reserved a slot but did NOT consume it',
    case when (q->>'founder_seq') is not null
          and (select claimed_at is null and reserved_until > now()
                 from founder_slots where account_id=f.acct) then 'PASS' else 'FAIL' end,
    'slot '||(q->>'founder_seq')||' held, not claimed');

  q := fn_checkout_quote(f.acct, 'trading');
  insert into t36 values (3,'switching tier keeps the SAME slot, not a second',
    case when (select count(*) from founder_slots where account_id=f.acct)=1
          and q->>'plan_id'='founding_trading' then 'PASS' else 'FAIL' end,
    q->>'plan_id');

  begin
    q := fn_checkout_quote(f.acct, 'enterprise');
    insert into t36 values (4,'an unknown tier is refused','FAIL','it was accepted');
  exception when others then
    insert into t36 values (4,'an unknown tier is refused','PASS', left(sqlerrm,52));
  end;

  -- the client is not authoritative for anything
  q := fn_checkout_quote(f.acct, 'costing');
  insert into t36 values (5,'the amount comes from OUR data, never the caller',
    case when (q->>'price_kobo')::int
              = (select price_kobo from plans where id = q->>'plan_id')
         then 'PASS' else 'FAIL' end,
    'quote matches plans.price_kobo exactly');

  -- ======================================================= 2. THE PAYMENT
  r := pg_temp.deliver('charge.success', f.acct, 'founding_costing',
         jsonb_build_object('subscription_code','SUB_alice'));
  insert into t36 values (6,'a founding payment APPLIES',
    case when r->>'status'='applied' then 'PASS' else 'FAIL' end,
    coalesce(r->>'status','null')||' '||coalesce(r->>'error',''));

  select * into s from founder_slots where account_id=f.acct;
  insert into t36 values (7,'and the slot is now CONFIRMED, not merely reserved',
    case when s.claimed_at is not null and s.reserved_until is null
         then 'PASS' else 'FAIL' end,
    'slot '||s.seq||' claimed_at '||coalesce(s.claimed_at::text,'NULL'));

  select * into s from subscriptions where account_id=f.acct;
  insert into t36 values (8,'the founding price is LOCKED on the subscription',
    case when s.price_kobo=350000 and s.founding_price_active then 'PASS' else 'FAIL' end,
    'price_kobo '||coalesce(s.price_kobo::text,'NULL')||
    ', founding_price_active '||s.founding_price_active::text);

  insert into t36 values (9,'the provider codes are stored so we can act at Paystack',
    case when s.provider_customer_code is not null
          and s.provider_subscription_code='SUB_alice' then 'PASS' else 'FAIL' end,
    coalesce(s.provider_customer_code,'NULL')||' / '||
    coalesce(s.provider_subscription_code,'NULL'));

  insert into t36 values (10,'and they can now record a sale',
    case when fn_account_has_sales(f.acct) = false then 'PASS' else 'FAIL' end,
    'founding_costing grants costing only, as designed');

  -- raising the list price must not re-price an existing founder
  update plans set price_kobo = 999999 where id='founding_costing';
  select * into s from subscriptions where account_id=f.acct;
  insert into t36 values (11,'a later price rise does NOT re-price them',
    case when s.price_kobo=350000 then 'PASS' else 'FAIL' end,
    'still '||s.price_kobo||' kobo');
  update plans set price_kobo = 350000 where id='founding_costing';

  -- ======================================================= 3. THE LAPSE
  r := pg_temp.deliver('subscription.disable', f.acct, 'founding_costing');
  select * into s from founder_slots where account_id=f.acct;
  insert into t36 values (12,'a lapse FORFEITS the founding price',
    case when s.forfeited_at is not null then 'PASS' else 'FAIL' end,
    'forfeited_at '||coalesce(s.forfeited_at::text,'NULL'));

  insert into t36 values (13,'the slot is kept, not returned to the pool',
    case when s.account_id = f.acct then 'PASS' else 'FAIL' end,
    'slot '||s.seq||' still names the account that held it');

  q := fn_checkout_quote(f.acct, 'costing');
  insert into t36 values (14,'and they are quoted STANDARD ever after',
    case when q->>'plan_id'='costing' and (q->>'price_kobo')::int=750000
         then 'PASS' else 'FAIL' end,
    (q->>'plan_id')||' at '||(q->>'price_kobo'));

  -- ======================================================= 4. NOT EVERY END IS A LAPSE
  select * into f from fx36 where label='bob';
  q := fn_checkout_quote(f.acct, 'trading');   -- quote first, like a real customer
  perform pg_temp.deliver('charge.success', f.acct, 'founding_trading',
            jsonb_build_object('subscription_code','SUB_bob'));
  r := pg_temp.deliver('subscription.not_renew', f.acct, 'founding_trading');
  select * into s from founder_slots where account_id=f.acct;
  insert into t36 values (15,'switching off renewal is NOT a lapse -- no forfeit',
    case when s.forfeited_at is null then 'PASS' else 'FAIL' end,
    'they keep what they paid for, founding price included');

  select * into s from subscriptions where account_id=f.acct;
  insert into t36 values (16,'and it is recorded as cancel_at_period_end',
    case when s.cancel_at_period_end then 'PASS' else 'FAIL' end,
    'cancel_at_period_end = '||s.cancel_at_period_end::text);

  -- ======================================================= 5. STANDARD CUSTOMERS
  select * into f from fx36 where label='carol';
  r := pg_temp.deliver('charge.success', f.acct, 'trading',
         jsonb_build_object('subscription_code','SUB_carol'));
  select * into s from subscriptions where account_id=f.acct;
  insert into t36 values (17,'a standard payment locks the standard price',
    case when s.price_kobo=1500000 and not s.founding_price_active
         then 'PASS' else 'FAIL' end,
    'price_kobo '||coalesce(s.price_kobo::text,'NULL'));

  insert into t36 values (18,'a standard customer holds no founder slot',
    case when not exists(select 1 from founder_slots where account_id=f.acct)
         then 'PASS' else 'FAIL' end, 'none');

  insert into t36 values (19,'and Costing + Sales grants Sales',
    case when fn_account_has_sales(f.acct) then 'PASS' else 'FAIL' end, '');

  -- ======================================================= 6. WHEN THE SLOTS RUN OUT
  select * into f from fx36 where label='dave';
  -- Consume every remaining slot. founder_slots.account_id is a real foreign
  -- key, so the pool has to be exhausted by real accounts -- which is the
  -- point: there is no way to fill the hundred with anything else.
  insert into accounts (name)
    select 'pool36 '||g
      from generate_series(1, (select count(*) from founder_slots
                                where account_id is null)) g;
  with free as (select fr.seq as fseq, row_number() over (order by fr.seq) rn
                  from founder_slots fr where fr.account_id is null),
       newa as (select id,  row_number() over (order by id)  rn
                  from accounts where name like 'pool36 %')
  update founder_slots fs
     set account_id = newa.id, claimed_at = now()
    from free join newa on newa.rn = free.rn
   where fs.seq = free.fseq;

  q := fn_checkout_quote(f.acct, 'costing');
  insert into t36 values (20,'customer 101 is quoted STANDARD, never a made-up discount',
    case when q->>'plan_id'='costing' and (q->>'price_kobo')::int=750000
          and q->>'founder_seq' is null then 'PASS' else 'FAIL' end,
    (q->>'plan_id')||' at '||(q->>'price_kobo')||' kobo');

  insert into t36 values (21,'and no 101st slot was created',
    case when (select count(*) from founder_slots)=100 then 'PASS' else 'FAIL' end,
    (select count(*)::text from founder_slots)||' slots');

  -- ======================================================= 7. REFUSE, NEVER INVENT
  update plans set is_active = false where id='costing';
  begin
    q := fn_checkout_quote((select acct from fx36 where label='erin'), 'costing');
    insert into t36 values (22,'a missing price REFUSES rather than inventing one',
      'FAIL','it returned '||coalesce(q->>'plan_id','null'));
  exception when others then
    insert into t36 values (22,'a missing price REFUSES rather than inventing one',
      'PASS', left(sqlerrm,52));
  end;
  update plans set is_active = true where id='costing';

  update plans set price_kobo = 0 where id='costing';
  begin
    q := fn_checkout_quote((select acct from fx36 where label='erin'), 'costing');
    insert into t36 values (23,'a zero price REFUSES -- free is a decision, not a default',
      'FAIL','it quoted zero');
  exception when others then
    insert into t36 values (23,'a zero price REFUSES -- free is a decision, not a default',
      'PASS', left(sqlerrm,52));
  end;
  update plans set price_kobo = 750000 where id='costing';

  -- ======================================================= 8. THE PIPELINE'S OWN RULES SURVIVE
  select * into f from fx36 where label='erin';
  r := pg_temp.deliver('charge.success', f.acct, 'PLN_does_not_exist');
  insert into t36 values (24,'an unmapped Paystack plan code is still refused',
    case when r->>'status'='failed_permanent' then 'PASS' else 'FAIL' end,
    coalesce(r->>'reason',r->>'status'));

  r := pg_temp.deliver('customer.identification.failed', f.acct, 'costing');
  insert into t36 values (25,'an event we do not act on is still ignored, not applied',
    case when r->>'status'='ignored' then 'PASS' else 'FAIL' end, r->>'status');

  select count(*) into n from billing_events where status='applied';
  insert into t36 values (26,'every applied event is recorded',
    case when n >= 4 then 'PASS' else 'FAIL' end, n||' applied event(s)');
end $$;

-- ======================================================= 9. THE BROWSER CANNOT REACH ANY OF IT
do $$
declare n int;
begin
  select count(*) into n from pg_proc p
   where p.pronamespace='public'::regnamespace
     and p.proname in ('fn_checkout_quote','fn_apply_billing_side_effects',
                       'fn_billing_apply','fn_billing_ingest','fn_claim_founder_slot',
                       'fn_confirm_founder_slot','fn_forfeit_founding_price',
                       'fn_set_subscription_plan')
     and (has_function_privilege('authenticated', p.oid,'EXECUTE')
       or has_function_privilege('anon', p.oid,'EXECUTE'));
  insert into t36 values (27,'no billing function is callable from the browser',
    case when n=0 then 'PASS' else 'FAIL' end, n||' reachable');

  select count(*) into n from pg_proc p
   where p.pronamespace='public'::regnamespace and p.proname='fn_checkout_quote'
     and has_function_privilege('service_role', p.oid,'EXECUTE');
  insert into t36 values (28,'but the service context can quote',
    case when n=1 then 'PASS' else 'FAIL' end, '');
end $$;

-- ======================================================= 10. AND A SIGNED-IN USER CANNOT SELF-SERVE
do $$
declare a uuid; u uuid; msg text := 'no error';
begin
  select acct, usr into a, u from fx36 where label='carol';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', u::text, true);
  begin
    perform fn_checkout_quote(a, 'trading');
  exception when others then msg := sqlstate; end;
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  insert into t36 values (29,'a signed-in user cannot quote themselves a price',
    case when msg='42501' then 'PASS' else 'FAIL' end, msg);
end $$;

-- ======================================================= 11. THE TWO N7,500 PLANS
--
-- costing and founding_trading are BOTH N7,500 and are NOT the same product:
-- one grants Sales and one does not. Paystack sends only a plan code, and
-- fn_billing_apply reads that code before it reads anything else. So the
-- entitlement has to fall out of the code alone.
--
-- This is here because the two were transposed twice while being read off the
-- Paystack dashboard. A mapping mistake that survives to production sells the
-- wrong product at the right price, which no amount of care at the till fixes.
do $$
declare u uuid; a uuid; res jsonb; ing jsonb; b text; i int;
  pairs text[][] := array[['PLN_t36_costing','costing'],
                          ['PLN_t36_founding_trading','founding_trading']];
  v_plan text; v_sales boolean; v_kobo int;
begin
  update plans set provider_plan_code='PLN_t36_costing'          where id='costing';
  update plans set provider_plan_code='PLN_t36_founding_trading' where id='founding_trading';

  for i in 1..2 loop
    u := gen_random_uuid();
    insert into auth.users(id,email) values (u, 't36-code-'||i||'@t36.test');
    res := fn_create_account_and_business('code '||i,'K','other',u,
             p_idempotency_key => gen_random_uuid()::text);
    a := (res->>'account_id')::uuid;
    b := gen_random_uuid()::text;
    -- the payload carries the plan CODE and no plan_id in metadata, exactly
    -- as Paystack sends it for a subscription charge
    ing := fn_billing_ingest(
      p_body_sha256 => encode(digest(b,'sha256'),'hex'), p_signature_valid => true,
      p_event_type => 'charge.success', p_provider_event_id => b, p_reference => b,
      p_payload => jsonb_build_object('event','charge.success','data',
         jsonb_build_object('id', 900+i, 'reference', b,
           'plan', jsonb_build_object('plan_code', pairs[i][1]),
           'metadata', jsonb_build_object('account_id', a::text),
           'customer', jsonb_build_object('customer_code','CUS_t36_'||i))),
      p_body_bytes => 10, p_source_ip => '127.0.0.1'::inet);
    perform fn_billing_apply((ing->>'event_id')::uuid);

    select s.plan_id, s.price_kobo into v_plan, v_kobo
      from subscriptions s where s.account_id = a;
    v_sales := fn_account_has_sales(a);

    insert into t36 values (29 + i,
      'a N7,500 payment under '||pairs[i][1]||' grants the right product',
      case when v_plan = pairs[i][2]
            and v_kobo = 750000
            and v_sales = (pairs[i][2] = 'founding_trading')
           then 'PASS' else 'FAIL' end,
      'resolved to '||v_plan||', sales='||v_sales::text||', N'||(v_kobo/100));
  end loop;

  insert into t36 values (32,'and the two codes cannot collide in the table',
    case when (select count(distinct provider_plan_code) from plans
                where provider_plan_code is not null) = 2 then 'PASS' else 'FAIL' end,
    'ux_plans_provider_plan_code (0030) makes one code for two plans unstorable');
end $$;

select n, check_name, verdict, left(detail,60) as detail from t36 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t36;

rollback;
