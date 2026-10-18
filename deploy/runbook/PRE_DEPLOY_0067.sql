-- ============================================================================
-- 0067 -- PRE-DEPLOY AUDIT            READ ONLY. Changes nothing.
-- Proves production is ready for 0067 (self-serve billing) and that the three
-- function bodies 0067 replaces are the ones it was written against. It
-- passes before and after 0066 so the whole release can be audited up front;
-- 0067 itself refuses to run until 0066 is in (row 1 says which).
-- Rows 8-12 are live counts only: no email, no code, no token is shown.
-- Row 10 reads the subscription code exactly as 0067's fn_billing_event_sub_code
-- will (data.subscription_code, then data.subscription, then data.plan).
-- Safe to paste into the Supabase SQL Editor: it is a single SELECT.
-- EXPECTED: 12 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'order: 0066_trial_gate goes in first',
         true,
         case when to_regprocedure('public.fn_require_entitled(uuid, boolean)') is not null
              then '0066 applied: 0067 may run now'
              else 'NOT YET: apply 0066 first (0065 before it, if 0065 ships); 0067 refuses to run without 0066' end
  union all select 2, 'identity: 118 policies; 102 fn_* with 0066 (99 without it)',
         (select count(*) from pg_policies where schemaname='public') = 118
         and (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%')
             = case when to_regprocedure('public.fn_require_entitled(uuid, boolean)') is not null then 102 else 99 end,
         (select count(*)::text from pg_policies where schemaname='public') || ' policies, '
         || (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') || ' fn_*'
  union all select 3, 'not yet applied: no billing_superseded, none of the five 0067 functions',
         to_regclass('public.billing_superseded') is null
         and not exists (select 1 from pg_proc where pronamespace='public'::regnamespace
                          and proname in ('fn_billing_event_sub_code','fn_billing_find_account','fn_billing_claim_switch_offs',
                                          'fn_billing_record_switch_off','fn_billing_record_manage_request')), ''
  union all select 4, 'fn_billing_apply is the 0051 body 0067 replaces',
         (select md5(replace(prosrc, chr(13), '')) from pg_proc where pronamespace='public'::regnamespace and proname='fn_billing_apply')
           = '82a53c707c3597dd86b3c3b1b7d634a9',
         coalesce((select md5(replace(prosrc, chr(13), '')) from pg_proc where pronamespace='public'::regnamespace and proname='fn_billing_apply'), 'missing')
  union all select 5, 'fn_apply_billing_side_effects is the 0050 body 0067 replaces',
         (select md5(replace(prosrc, chr(13), '')) from pg_proc where pronamespace='public'::regnamespace and proname='fn_apply_billing_side_effects')
           = 'd7921e3bf95357d70b8062f85e1754b5',
         coalesce((select md5(replace(prosrc, chr(13), '')) from pg_proc where pronamespace='public'::regnamespace and proname='fn_apply_billing_side_effects'), 'missing')
  union all select 6, 'fn_admin_scan is the 0055 body 0067 replaces',
         (select md5(replace(prosrc, chr(13), '')) from pg_proc where pronamespace='public'::regnamespace and proname='fn_admin_scan')
           = '8d402ad907dcd23906a333f70217a1f9',
         coalesce((select md5(replace(prosrc, chr(13), '')) from pg_proc where pronamespace='public'::regnamespace and proname='fn_admin_scan'), 'missing')
  union all select 7, 'the platform alert kinds are the six 0055 kinds',
         (select pg_get_constraintdef(oid) from pg_constraint where conname='ck_platform_alerts_kind')
           = 'CHECK ((kind = ANY (ARRAY[''billing_failed_permanent''::text, ''billing_stuck''::text, '
             '''founder_slots_low''::text, ''founder_slots_exhausted''::text, ''past_due_beyond_grace''::text, '
             '''subscription_no_period''::text])))', ''
  union all select 8, 'live: billing events that failed as no_account, by type (0067 attributes new ones; old ones stay for review)',
         true,
         coalesce((select string_agg(event_type || ' ' || c, ', ' order by event_type)
                     from (select event_type, count(*)::text c from billing_events
                            where status='failed_permanent' and last_error_code='no_account'
                            group by event_type) x), 'none')
  union all select 9, 'live: paying accounts with no Paystack subscription code on file',
         true,
         (select count(*)::text from subscriptions
           where status <> 'trialing' and provider_subscription_code is null)
         || ' (each one is refused a self-serve plan change until a code is on file)'
  union all select 10, 'live: of those, how many 0067 recovers (exactly one subscription.create code, customer code unique)',
         true,
         (select count(*) filter (where n_codes = 1)::text || ' recoverable, '
                 || count(*) filter (where n_codes > 1)::text || ' with two or more codes (review: possible double billing)'
            from (select s.id, count(distinct coalesce(nullif(be.payload #>> '{data,subscription_code}', ''),
                                                       nullif(be.payload #>> '{data,subscription,subscription_code}', ''),
                                                       nullif(be.payload #>> '{data,plan,subscription_code}', ''))) n_codes
                    from subscriptions s
                    join billing_events be
                      on be.event_type = 'subscription.create' and be.signature_valid
                     and be.payload #>> '{data,customer,customer_code}' = s.provider_customer_code
                     and coalesce(nullif(be.payload #>> '{data,subscription_code}', ''),
                                  nullif(be.payload #>> '{data,subscription,subscription_code}', ''),
                                  nullif(be.payload #>> '{data,plan,subscription_code}', '')) is not null
                   where s.provider_subscription_code is null and s.status <> 'trialing'
                     and s.provider_customer_code is not null
                     and (select count(*) from subscriptions s2
                           where s2.provider_customer_code = s.provider_customer_code) = 1
                   group by s.id) r)
  union all select 11, 'live: Paystack customer codes held by two or more accounts (their unattributed events fail closed)',
         true,
         (select count(*)::text from (select provider_customer_code from subscriptions
                                        where provider_customer_code is not null
                                        group by 1 having count(*) > 1) x)
  union all select 12, 'live: subscription_changes rows today (0067 adds to it, never rewrites it)',
         true, (select count(*)::text from subscription_changes)
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
