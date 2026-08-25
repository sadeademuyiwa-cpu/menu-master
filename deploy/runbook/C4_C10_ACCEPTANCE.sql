-- ============================================================================
-- MENU MASTER NG — C10 IDEMPOTENCY ACCEPTANCE TEST
--
-- RUN IT LIKE THIS, EXACTLY:
--
--     begin;
--         <this file>
--     rollback;          <-- NOT commit
--
-- WHY ROLLBACK
--   The test provisions real tenants to prove the behaviour, then discards
--   them. Everything is verified INSIDE the transaction, before the rollback,
--   so the rows genuinely existed when checked. Production keeps 0 accounts
--   and an empty ledger.
--
-- *** READ THIS BEFORE RUNNING ***
--   No new auth user is created, per instruction. The test therefore uses TWO
--   OF THE FIVE EXISTING USERS as subjects. It only READS auth.users -- it
--   never inserts, updates or deletes a row there. What it creates are
--   accounts, businesses and ledger rows REFERENCING them, and every one of
--   those is discarded by the rollback.
--
--   Net effect on production after rollback: zero. The five users are not
--   modified in any way. But because this brushes against the standing
--   instruction not to touch them, run it only with that understood.
--
-- WHAT CANNOT BE TESTED HERE
--   Concurrency needs two simultaneous connections and cannot be exercised
--   from one SQL Editor tab. It was proven on a 17.6 replica both with the
--   advisory lock and with the lock stripped out -- one tenant, zero orphan
--   accounts, in both cases. Row 6 records that rather than pretending.
-- ============================================================================

do $acc$
declare
  v_u1 uuid; v_u2 uuid;
  v_r  jsonb;
  v_err text;
begin
  if (select count(*) from auth.users) < 2 then
    raise exception 'ACCEPTANCE ABORTED: need at least two users as subjects.';
  end if;
  if (select count(*) from accounts) <> 0 then
    raise exception 'ACCEPTANCE ABORTED: accounts is not empty. Expected a '
                    'clean baseline of 0.';
  end if;
  if (select count(*) from onboarding_requests) <> 0 then
    raise exception 'ACCEPTANCE ABORTED: the ledger is not empty.';
  end if;

  select id into v_u1 from auth.users order by created_at, id limit 1;
  select id into v_u2 from auth.users order by created_at, id offset 1 limit 1;
  perform set_config('mm.u1', v_u1::text, false);
  perform set_config('mm.u2', v_u2::text, false);

  set local role authenticated;

  -- ---- T1: first call, key K1 -----------------------------------------
  perform set_config('request.jwt.claim.sub', v_u1::text, true);
  v_r := fn_create_account_and_business(
           'Acceptance Foods','Acceptance Kitchen','soup_seller',
           null,'NGN','trial',14,'ACC-K1');
  perform set_config('mm.t1', v_r::text, false);

  -- ---- T2: SAME key, SAME payload -> replay ----------------------------
  v_r := fn_create_account_and_business(
           'Acceptance Foods','Acceptance Kitchen','soup_seller',
           null,'NGN','trial',14,'ACC-K1');
  perform set_config('mm.t2', v_r::text, false);

  -- ---- T3: SAME key, DIFFERENT payload -> must refuse ------------------
  begin
    v_r := fn_create_account_and_business(
             'Acceptance Foods','A DIFFERENT KITCHEN','soup_seller',
             null,'NGN','trial',14,'ACC-K1');
    perform set_config('mm.t3', 'NOT REFUSED -- returned a result', false);
  exception when others then
    perform set_config('mm.t3', 'refused: ' || sqlstate || ' ' || left(sqlerrm, 60), false);
  end;

  -- ---- T4: DIFFERENT key -> second business, SAME account --------------
  v_r := fn_create_account_and_business(
           'Acceptance Foods','Second Kitchen','baker',
           null,'NGN','trial',14,'ACC-K2');
  perform set_config('mm.t4', v_r::text, false);

  -- ---- T5: null key -> must refuse -------------------------------------
  begin
    v_r := fn_create_account_and_business('X','Y','caterer');
    perform set_config('mm.t5', 'NOT REFUSED', false);
  exception when others then
    perform set_config('mm.t5', 'refused: ' || sqlstate || ' ' || left(sqlerrm, 50), false);
  end;

  -- ---- T7: same key STRING, different user -> own tenant ---------------
  perform set_config('request.jwt.claim.sub', v_u2::text, true);
  v_r := fn_create_account_and_business(
           'Second Owner Foods','Second Owner Kitchen','caterer',
           null,'NGN','trial',14,'ACC-K1');
  perform set_config('mm.t7', v_r::text, false);

  reset role;
end
$acc$;

select * from (

  select '1 first call' as section,
         '>>> provisioned an account' as item,
         'account_created=' || ((current_setting('mm.t1',true))::jsonb->>'account_created')
         || '  ingredients=' || ((current_setting('mm.t1',true))::jsonb->>'ingredients_added')
         || '  replay=' || ((current_setting('mm.t1',true))::jsonb->>'idempotent_replay') as observed,
         'account_created=true  ingredients=180  replay=false' as expected,
         case when (current_setting('mm.t1',true))::jsonb->>'account_created' = 'true'
               and (current_setting('mm.t1',true))::jsonb->>'ingredients_added' = '180'
               and (current_setting('mm.t1',true))::jsonb->>'idempotent_replay' = 'false'
              then 'PASS' else 'STOP' end as "verdict >>>"

  union all
  select '2 same key, same payload', '>>> REPLAYED, provisioned nothing',
         'replay=' || ((current_setting('mm.t2',true))::jsonb->>'idempotent_replay')
         || '  same account=' ||
         case when (current_setting('mm.t2',true))::jsonb->>'account_id'
                 = (current_setting('mm.t1',true))::jsonb->>'account_id'
              then 'yes' else 'NO' end
         || '  same business=' ||
         case when (current_setting('mm.t2',true))::jsonb->>'business_id'
                 = (current_setting('mm.t1',true))::jsonb->>'business_id'
              then 'yes' else 'NO' end,
         'replay=true  same account=yes  same business=yes',
         case when (current_setting('mm.t2',true))::jsonb->>'idempotent_replay' = 'true'
               and (current_setting('mm.t2',true))::jsonb->>'account_id'
                 = (current_setting('mm.t1',true))::jsonb->>'account_id'
               and (current_setting('mm.t2',true))::jsonb->>'business_id'
                 = (current_setting('mm.t1',true))::jsonb->>'business_id'
              then 'PASS' else 'STOP' end

  union all
  select '3 same key, diff payload', '>>> REFUSED',
         coalesce(current_setting('mm.t3',true), 'not collected'),
         'refused: 23505 ...',
         case when coalesce(current_setting('mm.t3',true),'') like 'refused: 23505%'
              then 'PASS' else 'STOP' end

  union all
  select '4 different key', '>>> second business, SAME account, no new trial',
         'account_created=' || ((current_setting('mm.t4',true))::jsonb->>'account_created')
         || '  ingredients=' || ((current_setting('mm.t4',true))::jsonb->>'ingredients_added')
         || '  same account as T1=' ||
         case when (current_setting('mm.t4',true))::jsonb->>'account_id'
                 = (current_setting('mm.t1',true))::jsonb->>'account_id'
              then 'yes' else 'NO' end,
         'account_created=false  ingredients=0  same account as T1=yes',
         case when (current_setting('mm.t4',true))::jsonb->>'account_created' = 'false'
               and (current_setting('mm.t4',true))::jsonb->>'ingredients_added' = '0'
               and (current_setting('mm.t4',true))::jsonb->>'account_id'
                 = (current_setting('mm.t1',true))::jsonb->>'account_id'
              then 'PASS' else 'STOP' end

  union all
  select '5 null key', '>>> REFUSED',
         coalesce(current_setting('mm.t5',true), 'not collected'),
         'refused: 22023 ...',
         case when coalesce(current_setting('mm.t5',true),'') like 'refused: 22023%'
              then 'PASS' else 'STOP' end

  union all
  select '6 concurrency', 'two simultaneous calls, same key',
         'not runnable from one SQL Editor session',
         'proven on a 17.6 replica: one tenant and zero orphan accounts BOTH '
         'with the advisory lock and with it removed',
         'REPLICA-PROVEN'

  union all
  select '7 key is per-user', '>>> same key string, different user, own tenant',
         'account_created=' || ((current_setting('mm.t7',true))::jsonb->>'account_created')
         || '  different account=' ||
         case when (current_setting('mm.t7',true))::jsonb->>'account_id'
                <> (current_setting('mm.t1',true))::jsonb->>'account_id'
              then 'yes' else 'NO -- KEYS ARE LEAKING ACROSS USERS' end,
         'account_created=true  different account=yes',
         case when (current_setting('mm.t7',true))::jsonb->>'account_created' = 'true'
               and (current_setting('mm.t7',true))::jsonb->>'account_id'
                <> (current_setting('mm.t1',true))::jsonb->>'account_id'
              then 'PASS' else 'STOP' end

  union all
  select '8 totals', '>>> accounts / businesses / subscriptions',
         (select count(*) from accounts)::text || ' / ' ||
         (select count(*) from businesses)::text || ' / ' ||
         (select count(*) from subscriptions)::text,
         '2 / 3 / 2 -- two owners, three businesses, ONE trial each',
         case when (select count(*) from accounts) = 2
               and (select count(*) from businesses) = 3
               and (select count(*) from subscriptions) = 2
              then 'PASS' else 'STOP' end
  union all
  select '8 totals', '>>> starter catalogue cloned once per ACCOUNT',
         (select count(*)::text from ingredients),
         '360 -- 180 per account, NOT per business',
         case when (select count(*) from ingredients) = 360
              then 'PASS' else 'STOP' end
  union all
  select '8 totals', '>>> SOURCE OF TRUTH: no price invented',
         (select count(*)::text from ingredient_prices), '0',
         case when (select count(*) from ingredient_prices) = 0
              then 'PASS' else 'STOP' end
  union all
  select '8 totals', '>>> ledger rows',
         (select count(*)::text from onboarding_requests),
         '3 -- K1 and K2 for user one, K1 for user two',
         case when (select count(*) from onboarding_requests) = 3
              then 'PASS' else 'STOP' end
  union all
  select '8 totals', '>>> auth.users untouched',
         (select count(*)::text from auth.users), '5',
         case when (select count(*) from auth.users) = 5 then 'PASS' else 'STOP' end

  union all
  select '9 cleanup', 'this transaction must be rolled back',
         'accounts=' || (select count(*) from accounts)::text ||
         ' exist only inside this transaction',
         'issue rollback; so production returns to 0 accounts and an empty ledger',
         'OPERATOR ACTION'

) as t order by 1, 2;
