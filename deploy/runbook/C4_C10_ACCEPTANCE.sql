-- ============================================================================
-- MENU MASTER NG — C10 IDEMPOTENCY ACCEPTANCE TEST  (dedicated test user)
--
-- ############################################################################
-- ##  EDIT ONE LINE BEFORE RUNNING: put the temporary user's UUID below.    ##
-- ############################################################################
--
-- RUN IT LIKE THIS, EXACTLY:
--
--     begin;
--         <this file, with the UUID filled in>
--     rollback;          <-- NOT commit
--
-- THE FIVE EXISTING USERS ARE NOT INVOLVED
--   This test acts on ONE dedicated throwaway user and nothing else. It
--   refuses to run if the UUID given belongs to a user created before
--   2026-08-15, which is every one of the five. It never reads them as
--   subjects, never provisions for them, and never writes to auth.users at
--   all -- no INSERT, no UPDATE, no DELETE, in this file or anywhere in C10.
--
-- WHY ROLLBACK
--   The test provisions real rows to prove the behaviour, verifies them while
--   they exist, then discards everything. Production keeps 0 accounts and an
--   empty ledger. Only the Auth user survives, and it is removed afterwards
--   through the Dashboard, never from SQL.
--
-- WHAT IS NOT TESTED HERE, AND IS NOT CLAIMED
--   * Concurrency needs two simultaneous connections; one SQL Editor tab
--     cannot do it.
--   * "Same key string, different user" needs a second subject, which would
--     mean a second throwaway user.
--   Both were proven on a 17.6 replica and are reported as REPLICA-PROVEN
--   rather than dressed up as production results.
-- ============================================================================

do $acc$
declare
  v_user    uuid;
  v_created timestamptz;
  v_r       jsonb;
begin
  -- ########################################################################
  v_user := '00000000-0000-0000-0000-000000000000';   -- <<< PASTE UUID HERE
  -- ########################################################################

  if v_user = '00000000-0000-0000-0000-000000000000' then
    raise exception 'ACCEPTANCE ABORTED: the test user UUID was not filled in. '
                    'Edit the marked line before running.';
  end if;

  select u.created_at into v_created from auth.users u where u.id = v_user;

  if v_created is null then
    raise exception 'ACCEPTANCE ABORTED: no auth.users row with id %. Create the '
                    'temporary user through the Dashboard first.', v_user;
  end if;

  -- The five pre-existing users are dated 2026-08-10..14. This makes it
  -- impossible to select one of them, whatever UUID is pasted above.
  if v_created < '2026-08-15'::timestamptz then
    raise exception 'ACCEPTANCE ABORTED: user % was created at %, which places '
                    'it among the five protected pre-existing users. They must '
                    'not be used as test subjects.', v_user, v_created;
  end if;

  if exists (select 1 from memberships m where m.user_id = v_user) then
    raise exception 'ACCEPTANCE ABORTED: that user already holds a membership. '
                    'Do not run this twice against the same user.';
  end if;

  if (select count(*) from auth.users) <> 6 then
    raise exception 'ACCEPTANCE ABORTED: auth.users holds % rows, expected 6 '
                    '(five protected plus one temporary test user).',
                    (select count(*) from auth.users);
  end if;
  if (select count(*) from accounts) <> 0 then
    raise exception 'ACCEPTANCE ABORTED: accounts is not empty.';
  end if;
  if (select count(*) from onboarding_requests) <> 0 then
    raise exception 'ACCEPTANCE ABORTED: the ledger is not empty.';
  end if;

  perform set_config('mm.u', v_user::text, false);

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  -- ---- T1: first call, key K1 -------------------------------------------
  v_r := fn_create_account_and_business(
           'C10 Test Foods','C10 Test Kitchen','soup_seller',
           null,'NGN','trial',14,'C10-K1');
  perform set_config('mm.t1', v_r::text, false);

  -- ---- T2: SAME key, SAME payload -> replay ------------------------------
  v_r := fn_create_account_and_business(
           'C10 Test Foods','C10 Test Kitchen','soup_seller',
           null,'NGN','trial',14,'C10-K1');
  perform set_config('mm.t2', v_r::text, false);

  -- ---- T3: SAME key, DIFFERENT payload -> refuse -------------------------
  begin
    v_r := fn_create_account_and_business(
             'C10 Test Foods','A DIFFERENT KITCHEN','soup_seller',
             null,'NGN','trial',14,'C10-K1');
    perform set_config('mm.t3', 'NOT REFUSED -- returned a result', false);
  exception when others then
    perform set_config('mm.t3', 'refused: ' || sqlstate || ' ' || left(sqlerrm, 55), false);
  end;

  -- ---- T4: DIFFERENT key -> second business, SAME account ----------------
  v_r := fn_create_account_and_business(
           'C10 Test Foods','C10 Second Kitchen','baker',
           null,'NGN','trial',14,'C10-K2');
  perform set_config('mm.t4', v_r::text, false);

  -- ---- T5: null key -> refuse --------------------------------------------
  begin
    v_r := fn_create_account_and_business('X','Y','caterer');
    perform set_config('mm.t5', 'NOT REFUSED', false);
  exception when others then
    perform set_config('mm.t5', 'refused: ' || sqlstate || ' ' || left(sqlerrm, 45), false);
  end;

  -- ---- T6: blank key -> refuse -------------------------------------------
  begin
    v_r := fn_create_account_and_business('X','Y','caterer',null,'NGN','trial',14,'   ');
    perform set_config('mm.t6', 'NOT REFUSED', false);
  exception when others then
    perform set_config('mm.t6', 'refused: ' || sqlstate, false);
  end;

  reset role;
end
$acc$;

select * from (

  select '1 first call' as section, '>>> provisioned exactly once' as item,
         'account_created=' || ((current_setting('mm.t1',true))::jsonb->>'account_created')
         || '  ingredients=' || ((current_setting('mm.t1',true))::jsonb->>'ingredients_added')
         || '  replay=' || ((current_setting('mm.t1',true))::jsonb->>'idempotent_replay') as observed,
         'account_created=true  ingredients=180  replay=false' as expected,
         case when (current_setting('mm.t1',true))::jsonb->>'account_created' = 'true'
               and (current_setting('mm.t1',true))::jsonb->>'ingredients_added' = '180'
               and (current_setting('mm.t1',true))::jsonb->>'idempotent_replay' = 'false'
              then 'PASS' else 'STOP' end as "verdict >>>"

  union all
  select '2 same key same payload', '>>> REPLAYS THE EXACT TENANT',
         'replay=' || ((current_setting('mm.t2',true))::jsonb->>'idempotent_replay')
         || '  same account=' ||
         case when (current_setting('mm.t2',true))::jsonb->>'account_id'
                 = (current_setting('mm.t1',true))::jsonb->>'account_id'
              then 'yes' else 'NO' end
         || '  same business=' ||
         case when (current_setting('mm.t2',true))::jsonb->>'business_id'
                 = (current_setting('mm.t1',true))::jsonb->>'business_id'
              then 'yes' else 'NO' end
         || '  same location=' ||
         case when (current_setting('mm.t2',true))::jsonb->>'location_id'
                 = (current_setting('mm.t1',true))::jsonb->>'location_id'
              then 'yes' else 'NO' end,
         'replay=true  same account=yes  same business=yes  same location=yes',
         case when (current_setting('mm.t2',true))::jsonb->>'idempotent_replay' = 'true'
               and (current_setting('mm.t2',true))::jsonb->>'account_id'
                 = (current_setting('mm.t1',true))::jsonb->>'account_id'
               and (current_setting('mm.t2',true))::jsonb->>'business_id'
                 = (current_setting('mm.t1',true))::jsonb->>'business_id'
               and (current_setting('mm.t2',true))::jsonb->>'location_id'
                 = (current_setting('mm.t1',true))::jsonb->>'location_id'
              then 'PASS' else 'STOP' end

  union all
  select '3 same key diff payload', '>>> REFUSED',
         coalesce(current_setting('mm.t3',true), 'not collected'),
         'refused: 23505 ...',
         case when coalesce(current_setting('mm.t3',true),'') like 'refused: 23505%'
              then 'PASS' else 'STOP' end

  union all
  select '4 different key', '>>> second business in the SAME account',
         'account_created=' || ((current_setting('mm.t4',true))::jsonb->>'account_created')
         || '  ingredients=' || ((current_setting('mm.t4',true))::jsonb->>'ingredients_added')
         || '  same account=' ||
         case when (current_setting('mm.t4',true))::jsonb->>'account_id'
                 = (current_setting('mm.t1',true))::jsonb->>'account_id'
              then 'yes' else 'NO' end
         || '  new business=' ||
         case when (current_setting('mm.t4',true))::jsonb->>'business_id'
                <> (current_setting('mm.t1',true))::jsonb->>'business_id'
              then 'yes' else 'NO' end,
         'account_created=false  ingredients=0  same account=yes  new business=yes',
         case when (current_setting('mm.t4',true))::jsonb->>'account_created' = 'false'
               and (current_setting('mm.t4',true))::jsonb->>'ingredients_added' = '0'
               and (current_setting('mm.t4',true))::jsonb->>'account_id'
                 = (current_setting('mm.t1',true))::jsonb->>'account_id'
               and (current_setting('mm.t4',true))::jsonb->>'business_id'
                <> (current_setting('mm.t1',true))::jsonb->>'business_id'
              then 'PASS' else 'STOP' end

  union all
  select '5 null key', '>>> REFUSED',
         coalesce(current_setting('mm.t5',true), 'not collected'), 'refused: 22023 ...',
         case when coalesce(current_setting('mm.t5',true),'') like 'refused: 22023%'
              then 'PASS' else 'STOP' end
  union all
  select '5 blank key', '>>> REFUSED',
         coalesce(current_setting('mm.t6',true), 'not collected'), 'refused: 22023',
         case when coalesce(current_setting('mm.t6',true),'') like 'refused: 22023%'
              then 'PASS' else 'STOP' end

  union all
  select '6 no duplicate tenant', '>>> accounts / businesses / memberships',
         (select count(*) from accounts)::text || ' / ' ||
         (select count(*) from businesses)::text || ' / ' ||
         (select count(*) from memberships)::text,
         '1 / 2 / 1 -- one account, two businesses, ONE owner membership',
         case when (select count(*) from accounts) = 1
               and (select count(*) from businesses) = 2
               and (select count(*) from memberships) = 1
              then 'PASS' else 'STOP' end
  union all
  select '6 no duplicate tenant', '>>> subscriptions: no second trial',
         (select count(*)::text from subscriptions),
         '1 -- two businesses, ONE trial',
         case when (select count(*) from subscriptions) = 1
              then 'PASS' else 'STOP' end
  union all
  select '6 no duplicate tenant', '>>> catalogue cloned once per ACCOUNT',
         (select count(*)::text from ingredients),
         '180 -- NOT 360; the second business must not re-clone',
         case when (select count(*) from ingredients) = 180
              then 'PASS' else 'STOP' end
  union all
  select '6 no duplicate tenant', '>>> locations / business_settings / channels',
         (select count(*) from locations)::text || ' / ' ||
         (select count(*) from business_settings)::text || ' / ' ||
         (select count(*) from channels)::text,
         '2 / 2 / 2 -- one set per business',
         case when (select count(*) from locations) = 2
               and (select count(*) from business_settings) = 2
               and (select count(*) from channels) = 2
              then 'PASS' else 'STOP' end
  union all
  select '6 no duplicate tenant', '>>> ledger rows',
         (select count(*)::text from onboarding_requests),
         '2 -- C10-K1 and C10-K2',
         case when (select count(*) from onboarding_requests) = 2
              then 'PASS' else 'STOP' end

  union all
  select '7 source of truth', '>>> no price, conversion or yield invented',
         (select count(*) from ingredient_prices)::text || ' prices / ' ||
         (select count(*) from ingredient_unit_conversions)::text || ' conversions',
         '0 prices / 0 conversions',
         case when (select count(*) from ingredient_prices) = 0
               and (select count(*) from ingredient_unit_conversions) = 0
              then 'PASS' else 'STOP' end

  union all
  select '8 protected users', '>>> auth.users total',
         (select count(*)::text from auth.users),
         '6 -- five protected plus one temporary test user',
         case when (select count(*) from auth.users) = 6 then 'PASS' else 'STOP' end
  union all
  select '8 protected users', '>>> the five hold NOTHING',
         (select count(*)::text from memberships m
           join auth.users u on u.id = m.user_id
          where u.created_at < '2026-08-15'::timestamptz) || ' memberships',
         '0 -- none of the five was used as a subject',
         case when not exists (select 1 from memberships m
                                join auth.users u on u.id = m.user_id
                               where u.created_at < '2026-08-15'::timestamptz)
              then 'PASS' else 'STOP' end
  union all
  select '8 protected users', '>>> every provisioned row belongs to the test user',
         case when exists (select 1 from memberships m
                            where m.user_id::text <> current_setting('mm.u', true))
              then 'A ROW BELONGS TO SOMEONE ELSE' else 'yes' end,
         'yes',
         case when not exists (select 1 from memberships m
                                where m.user_id::text <> current_setting('mm.u', true))
              then 'PASS' else 'STOP' end

  union all
  select '9 not tested here', 'concurrent same-key requests',
         'needs two simultaneous connections',
         'replica-proven on 17.6: one tenant and zero orphan accounts BOTH with '
         'the advisory lock and with it removed',
         'REPLICA-PROVEN'
  union all
  select '9 not tested here', 'same key string under a different user',
         'would need a second throwaway user',
         'replica-proven on 17.6: each user gets its own tenant; keys are '
         'namespaced by user_id in the primary key',
         'REPLICA-PROVEN'

  union all
  select '10 cleanup', 'this transaction must be rolled back',
         'accounts=' || (select count(*) from accounts)::text ||
         ' exist only inside this transaction',
         'issue rollback; then delete the temporary user via the Dashboard',
         'OPERATOR ACTION'

) as t order by 1, 2;
