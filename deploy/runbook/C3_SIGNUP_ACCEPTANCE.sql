-- ============================================================================
-- MENU MASTER NG — SIGNUP ACCEPTANCE TEST  (post-0019c)
--
-- RUN IT LIKE THIS, EXACTLY:
--
--     begin;
--         <this file>
--     rollback;          <-- NOT commit
--
-- WHY ROLLBACK
--   This test provisions a complete tenant to prove the path works, then
--   discards it. Production keeps 0 accounts and the test leaves no fake
--   tenant behind. Everything is verified INSIDE the transaction, before the
--   rollback, so the proof is real -- the rows genuinely existed.
--
--   If you would rather keep the test tenant, run it with commit; instead.
--   That is a deliberate choice, not the default.
--
-- PREREQUISITE
--   A brand-new test user must already have been created through Supabase
--   Auth (Dashboard -> Authentication -> Add user, or the signup API). That
--   user's mere existence is itself the first half of the acceptance test:
--   before 0019c it was impossible.
--
-- SAFETY
--   The script refuses to run unless the user it selects was created within
--   the last 2 hours and holds no membership. The five pre-existing users are
--   from 2026-08-10..14 and can never be selected. It never UPDATEs or DELETEs
--   any auth.users row.
-- ============================================================================

do $$
declare
  v_user     uuid;
  v_created  timestamptz;
  v_total    integer;
  v_result   jsonb;
begin
  select count(*) into v_total from auth.users;

  -- The newest user, which must be the one just created for this test.
  select id, created_at into v_user, v_created
  from auth.users
  order by created_at desc
  limit 1;

  if v_user is null then
    raise exception 'ACCEPTANCE ABORTED: auth.users is empty.';
  end if;

  if v_created < now() - interval '2 hours' then
    raise exception 'ACCEPTANCE ABORTED: the newest user was created at %, which '
                    'is not recent. Create the test user first. This guard exists '
                    'so a pre-existing user can never be onboarded by accident.',
                    v_created;
  end if;

  if exists (select 1 from memberships where user_id = v_user) then
    raise exception 'ACCEPTANCE ABORTED: that user already has a membership. '
                    'It has been onboarded before -- do not run this twice.';
  end if;

  if v_total <> 6 then
    raise notice 'NOTE: auth.users holds % rows. Expected 6 (5 pre-existing + 1 '
                 'test user). Continuing, but check this is what you intended.',
                 v_total;
  end if;

  perform set_config('mm.acc_user', v_user::text, false);
  perform set_config('mm.acc_total_before', v_total::text, false);

  -- Onboard exactly as the client would: role authenticated, JWT subject set.
  -- This exercises the real authorisation path, not a service-context bypass.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  v_result := fn_create_account_and_business(
                'Acceptance Test Foods', 'Acceptance Test Kitchen', 'soup_seller');

  reset role;
  perform set_config('mm.acc_result', v_result::text, false);
end
$$;

select * from (

  select '1 auth' as section, '>>> a brand-new user exists (impossible before 0019c)' as item,
         'user ' || substr(md5(current_setting('mm.acc_user', true)), 1, 8) as observed,
         'created via Supabase Auth' as expected, 'PASS' as "verdict >>>"
  union all
  select '1 auth', '>>> pre-existing users untouched',
         (current_setting('mm.acc_total_before', true)::int - 1)::text || ' before this test',
         '5 -- the original users are never modified',
         case when current_setting('mm.acc_total_before', true)::int - 1 = 5
              then 'PASS' else 'STOP' end

  union all
  select '2 rpc', '>>> fn_create_account_and_business succeeded',
         case when current_setting('mm.acc_result', true) is not null
              then 'returned a result' else 'NO RESULT' end,
         'returned a result',
         case when current_setting('mm.acc_result', true) is not null
              then 'PASS' else 'STOP' end
  union all
  select '2 rpc', 'returned next_step',
         coalesce((current_setting('mm.acc_result', true)::jsonb)->>'next_step', '(none)'),
         'enter_your_own_prices',
         case when (current_setting('mm.acc_result', true)::jsonb)->>'next_step'
                   = 'enter_your_own_prices' then 'PASS' else 'STOP' end

  union all
  select '3 tenant', '>>> exactly one account / business / membership',
         (select count(*) from accounts)::text || ' / ' ||
         (select count(*) from businesses)::text || ' / ' ||
         (select count(*) from memberships)::text,
         '1 / 1 / 1',
         case when (select count(*) from accounts) = 1
               and (select count(*) from businesses) = 1
               and (select count(*) from memberships) = 1
              then 'PASS' else 'STOP' end
  union all
  select '3 tenant', '>>> the membership is owner, and is the test user',
         coalesce((select m.role::text || ' / ' ||
                          case when m.user_id::text = current_setting('mm.acc_user', true)
                               then 'correct user' else 'WRONG USER' end
                     from memberships m limit 1), 'NO MEMBERSHIP'),
         'owner / correct user',
         case when exists (select 1 from memberships m
                            where m.role = 'owner'
                              and m.user_id::text = current_setting('mm.acc_user', true))
              then 'PASS' else 'STOP' end
  union all
  select '3 tenant', '>>> Main location / business_settings / channel created',
         (select count(*) from locations)::text || ' / ' ||
         (select count(*) from business_settings)::text || ' / ' ||
         (select count(*) from channels)::text,
         '1 / 1 / 1',
         case when (select count(*) from locations) = 1
               and (select count(*) from business_settings) = 1
               and (select count(*) from channels) = 1
              then 'PASS' else 'STOP' end

  union all
  select '4 catalogue', '>>> 180 starter ingredients cloned',
         (select count(*)::text from ingredients), '180',
         case when (select count(*) from ingredients) = 180 then 'PASS' else 'STOP' end
  union all
  select '4 catalogue', '>>> SOURCE OF TRUTH: ingredient_prices still empty',
         (select count(*)::text from ingredient_prices) || ' price rows',
         '0 -- no price may be invented at onboarding',
         case when (select count(*) from ingredient_prices) = 0 then 'PASS' else 'STOP' end
  union all
  select '4 catalogue', '>>> no conversions or yields invented either',
         (select count(*) from ingredient_unit_conversions)::text || ' conversions',
         '0',
         case when (select count(*) from ingredient_unit_conversions) = 0
              then 'PASS' else 'STOP' end

  union all
  select '5 trial', '>>> exactly one trial subscription',
         coalesce((select count(*)::text || ' row(s), status=' ||
                          string_agg(distinct status, ',') from subscriptions), '0 rows'),
         '1 row(s), status=trialing',
         case when (select count(*) from subscriptions) = 1
               and exists (select 1 from subscriptions where status = 'trialing')
              then 'PASS' else 'STOP' end

  union all
  select '6 idempotency', 'retry protection (C10) -- NOT YET IMPLEMENTED',
         'a second call would create a SECOND account, business and trial',
         'C10 approved but not implemented; retry is NOT tested here because '
         'doing so would provision a duplicate tenant',
         'KNOWN GAP'

  union all
  select '7 cleanup', 'this transaction must be rolled back',
         'accounts=' || (select count(*) from accounts)::text ||
         ' -- these rows exist only inside this transaction',
         'issue rollback; so production returns to 0 accounts',
         'OPERATOR ACTION'

) as t order by 1, 2;
