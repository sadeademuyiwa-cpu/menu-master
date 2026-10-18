-- ============================================================================
-- BILLING_SUPPORT_CHECKS.sql     READ ONLY -- a single SELECT. Changes nothing.
--
-- The health of billing and accounts, in counts. Run it in Supabase -> SQL
-- Editor before answering a billing message (BILLING_SUPPORT.md says which
-- row matters for which message), and once a week while plan changes and
-- cancelling are new.
--
-- SAFE TO SHARE: counts, dates and yes/no only. No email, no business or
-- person's name, no Paystack code or token, no account id. To look at one
-- account, use the lookups in BILLING_SUPPORT.md instead.
--
-- Works on 0064 and later. The rows that read billing_superseded (0067) say
-- "0067 not applied" until it is there, instead of failing: query_to_xml runs
-- that read only when the table exists. Where 0066 or 0067 change what a
-- healthy answer is, the "good" column says so. Row 23 says which are in.
-- ============================================================================
with
ev as (
  select e.*,
         coalesce(e.account_id,
                  case when e.payload #>> '{data,metadata,account_id}'
                            ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       then (e.payload #>> '{data,metadata,account_id}')::uuid end) as acct,
         -- the three places Paystack puts the subscription code: subscription.*
         -- events, invoice.* events, and charges that name their plan
         nullif(coalesce(e.payload #>> '{data,subscription_code}',
                         e.payload #>> '{data,subscription,subscription_code}',
                         e.payload #>> '{data,plan,subscription_code}'), '') as sub_code
    from billing_events e
),
live as (
  select s.*
    from subscriptions s join accounts a on a.id = s.account_id and a.deleted_at is null
),
slots as (
  select count(*) filter (where claimed_at is null and account_id is null)                          as free,
         count(*) filter (where claimed_at is null and account_id is not null
                                and reserved_until >= now())                                         as held,
         count(*) filter (where claimed_at is null and account_id is not null
                                and (reserved_until < now() or reserved_until is null))              as stale,
         count(*) filter (where claimed_at is not null and forfeited_at is null)                    as claimed,
         count(*) filter (where forfeited_at is not null)                                           as forfeited,
         count(*)                                                                                   as total
    from founder_slots
),
two_logins as (
  select m.user_id,
         count(distinct m.account_id)                                   as accounts,
         count(distinct m.account_id) filter (where m.role = 'owner')  as owned
    from memberships m join accounts a on a.id = m.account_id and a.deleted_at is null
   group by m.user_id
  having count(distinct m.account_id) > 1
),
-- one row per successful charge (a redelivered notice of the same payment
-- counts once), with the one before it on the same account
charge_list as (
  select distinct on (acct, coalesce(reference, provider_event_id, id::text))
         acct,
         coalesce(case when payload #>> '{data,paid_at}' ~ '^\d{4}-\d{2}-\d{2}'
                       then (payload #>> '{data,paid_at}')::timestamptz end, received_at) as paid,
         -- our checkout says which subscription a plan change or "Pay now" replaces
         nullif(payload #>> '{data,metadata,replaces}', '') is not null                   as replaces
    from ev
   where event_type = 'charge.success' and signature_valid and acct is not null
     and last_error_code is distinct from 'superseded_charge'   -- those are row 4
   order by acct, coalesce(reference, provider_event_id, id::text), received_at
),
charges as (
  select acct, paid, replaces,
         lag(paid) over (partition by acct order by paid) as prev
    from charge_list
),
gate as (
  select to_regprocedure('public.fn_require_entitled(uuid,boolean)') is not null as has_0066,
         to_regclass('public.billing_superseded') is not null                    as has_0067
)
select n, sub, section, item, value, good from (
  -- 1. Paystack's notices
  select 1 as n, 0 as sub, 'Paystack notices' as section, 'all billing events, by result' as item,
         coalesce((select string_agg(status || '=' || c, ', ' order by status)
                     from (select status, count(*) as c from billing_events group by status) x), 'none yet') as value,
         'mostly applied. Ignored is normal for event types we do not act on and, after 0067, for a replaced subscription''s own notices; rows 4-6 pick out the ones that need you' as good
  union all
  select 2, row_number() over (order by event_type, status, last_error_code)::int, 'Paystack notices',
         'failed: ' || coalesce(event_type, '(unreadable)') || ' / ' || status || ' / ' || coalesce(last_error_code, '-'),
         c || ' | latest ' || to_char(latest at time zone 'Africa/Lagos', 'Dy DD Mon YYYY HH24:MI') || ' Lagos',
         case when status = 'rejected'
              then 'the signature did not check out: not sent by Paystack, or the webhook secret is wrong. Nothing was changed. More than a few: message the developer'
              when last_error_code = 'no_account'
              then 'no_account: the notice did not say which account it is for. On subscription.* or invoice.payment_failed it means a cancel or failed payment never reached the account (0067 matches new ones by subscription code; old ones: BILLING_SUPPORT.md section 8)'
              when last_error_code = 'unmapped_plan_code' then 'a Paystack plan code not linked to a plan: MAP_PLAN_CODES.sql'
              when last_error_code in ('ambiguous_customer', 'ambiguous_subscription')
              then 'a Paystack code that is on two accounts; nothing was changed, on purpose. Message the developer with the event id (L3)'
              when last_error_code in ('not_current_subscription', 'subscription_not_on_file', 'no_subscription_code')
              then 'a cancel or failed payment that is not for the account''s current subscription; nothing was changed, on purpose (row 5, BILLING_SUPPORT.md section 8)'
              when last_error_code = 'bad_metadata' then 'our checkout''s account id in the notice is not valid; message the developer'
              else 'look at it with BILLING_SUPPORT.md section 8' end
    from (select event_type, status, last_error_code, count(*) as c, max(received_at) as latest
            from billing_events
           where status in ('failed_permanent', 'failed_transient', 'rejected')
           group by event_type, status, last_error_code) f
  union all
  select 2, 0, 'Paystack notices', 'failed events', 'none', 'none'
   where not exists (select 1 from billing_events where status in ('failed_permanent', 'failed_transient', 'rejected'))
  union all
  select 3, 0, 'Paystack notices', 'events still waiting to be applied after an hour',
         (select count(*)::text from billing_events
           where status in ('received', 'processing', 'failed_transient') and received_at < now() - interval '1 hour'),
         '0'
  union all
  select 4, 0, 'Paystack notices', 'charges on a subscription the account had already left (superseded_charge): last 30 days | ever',
         (select count(*) filter (where received_at > now() - interval '30 days') || ' | ' || count(*)
                 || coalesce(' | latest ' || to_char(max(received_at) at time zone 'Africa/Lagos', 'Dy DD Mon YYYY'), '')
            from billing_events where status = 'ignored' and last_error_code = 'superseded_charge'),
         '0. EACH ONE IS A REFUND: the customer was charged on the old plan after moving to a new one. BILLING_SUPPORT.md section 4. The count stays after you refund, so keep a note of how many you have refunded'
  union all
  select 5, 0, 'Paystack notices', 'a cancel or failed payment held back because it is not for the current subscription: last 30 days | ever',
         (select count(*) filter (where received_at > now() - interval '30 days') || ' | ' || count(*)
                 || coalesce(' (' || string_agg(distinct last_error_code, ', ') || ')', '')
            from billing_events
           where last_error_code in ('not_current_subscription', 'subscription_not_on_file', 'no_subscription_code')),
         '0, or one or two right after you switched off a duplicate subscription in Paystack. Nothing on the account changed (0067 holds these back for a person). Any other: BILLING_SUPPORT.md section 8'
  union all
  select 6, 0, 'Paystack notices', 'possible double charges (possible_double_charge alerts): still open | raised in the last 30 days',
         (select count(*) filter (where resolved_at is null) || ' | '
                 || count(*) filter (where first_seen > now() - interval '30 days')
            from platform_alerts where kind = 'possible_double_charge'),
         '0 open. Each one: two payments close together on one account (two tabs, a double tap). Check Paystack and refund the one not meant: BILLING_SUPPORT.md section 4, then resolve the alert with a note'
  union all
  select 7, 0, 'Paystack notices', 'open admin alerts, by kind',
         coalesce((select string_agg(kind || '=' || c, ', ' order by kind)
                     from (select kind, count(*) as c from platform_alerts
                            where resolved_at is null group by kind) x), 'none'),
         'none. Billing kinds: superseded_subscription_charged and possible_double_charge = a refund to check (BILLING_SUPPORT.md section 4); subscription_not_switched_off = section 3; cancel_not_confirmed = section 2; billing_failed_permanent = row 2'
  union all
  -- 2. Paying accounts
  select 8, 0, 'paying accounts', 'paying accounts by status',
         coalesce((select string_agg(status || '=' || c, ', ' order by status)
                     from (select status, count(*) as c from live where status <> 'trialing' group by status) x), 'none'),
         'for your own picture; compare with Paystack -> Subscriptions'
  union all
  select 9, 0, 'paying accounts', 'active or overdue with NO Paystack subscription code stored',
         (select count(*) || ' (active ' || count(*) filter (where status = 'active')
                 || ', overdue ' || count(*) filter (where status = 'past_due') || ')'
            from live where status in ('active', 'past_due') and provider_subscription_code is null),
         '0. Without the code, Cancel plan and Update your card answer no_subscription, and a plan change or Pay now answers switch_needs_support ("message us"). DEPLOY_0067.md "Accounts with two or more subscription codes" shows how to put the live code on file'
  union all
  select 10, 0, 'paying accounts', 'active or overdue with NO Paystack customer code stored',
         (select count(*)::text from live where status in ('active', 'past_due') and provider_customer_code is null),
         '0'
  union all
  select 11, 0, 'paying accounts', 'active, but the paid-through date passed more than 2 days ago',
         (select count(*)::text from live where status = 'active' and current_period_end < now() - interval '2 days'),
         '0. They keep full use whatever the date. More than 0: look each one up in Paystack (L2 codes). Renewed there: the new period was not recorded (REPAIR_STALE_PAID_PERIOD.sql only if the period equals the trial end, otherwise section 9 with Paystack''s date). Non-renewing or cancelled there: section 9 with status cancelled'
  union all
  select 12, 0, 'paying accounts', 'overdue (a payment failed): still in the grace days | grace over, read-only',
         (select count(*) filter (where current_period_end + fn_payment_failure_grace() > now()) || ' | '
                 || count(*) filter (where current_period_end + fn_payment_failure_grace() <= now())
            from live where status = 'past_due'),
         'any number is possible. With self-serve on, the owner can Pay now, Update your card or Cancel plan; BILLING_SUPPORT.md section 5'
  union all
  select 13, 0, 'paying accounts', 'cancelled: still inside the paid month | month over',
         (select count(*) filter (where current_period_end > now()) || ' | '
                 || count(*) filter (where current_period_end <= now())
            from live where status = 'cancelled'),
         'for your own picture; "inside the paid month" keeps full use until its date'
  union all
  -- 3. Paying twice
  select 14, 0, 'paying twice?', 'accounts with two or more Paystack subscription codes not recorded as switched off',
         case when (select has_0067 from gate) then
           (xpath('/row/v/text()', query_to_xml($q$
              select count(*)::text as v
                from (select acct
                        from (select coalesce(e.account_id,
                                       case when e.payload #>> '{data,metadata,account_id}'
                                                 ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                            then (e.payload #>> '{data,metadata,account_id}')::uuid end) as acct,
                                     nullif(coalesce(e.payload #>> '{data,subscription_code}',
                                                     e.payload #>> '{data,subscription,subscription_code}',
                                                     e.payload #>> '{data,plan,subscription_code}'), '') as sub_code
                                from billing_events e
                               where e.signature_valid) c
                       where c.acct is not null and c.sub_code is not null
                         and not exists (select 1 from billing_superseded b
                                          where b.subscription_code = c.sub_code and b.disabled_at is not null)
                       group by c.acct
                      having count(distinct c.sub_code) > 1) x
            $q$, false, true, '')))[1]::text
         else
           (select count(*)::text from (select acct from ev
                                         where acct is not null and sub_code is not null and signature_valid
                                         group by acct having count(distinct sub_code) > 1) x)
           || ' (0067 not applied, so a code switched off after a plan change still counts)'
         end,
         '0. A code 0067 has switched off after a plan change does not count. More than 0: two subscriptions may both be renewing; BILLING_SUPPORT.md section 4'
  union all
  select 15, 0, 'paying twice?', 'old subscriptions replaced more than an hour ago and still not switched off at Paystack',
         case when (select has_0067 from gate) then
           (xpath('/row/v/text()', query_to_xml($q$
              select count(*) || coalesce(' | oldest replaced '
                       || to_char(min(recorded_at) at time zone 'Africa/Lagos', 'Dy DD Mon YYYY HH24:MI') || ' Lagos', '') as v
                from billing_superseded
               where disabled_at is null and recorded_at < now() - interval '1 hour'
            $q$, false, true, '')))[1]::text
         else '0067 not applied: nothing switches old subscriptions off yet' end,
         '0. More than 0: the old plan may charge again. BILLING_SUPPORT.md section 3 ("Two still active")'
  union all
  select 16, 0, 'paying twice?', 'accounts with two successful charges less than 25 days apart (plan changes, Pay now and row 4 left out)',
         (select count(distinct acct)::text from charges
           where prev is not null and paid - prev < interval '25 days' and not replaces),
         '0, or an account that cancelled and chose a plan again inside its paid month (that starts a new paid month). Any other: BILLING_SUPPORT.md section 4'
  union all
  -- 4. Logins and accounts
  select 17, 0, 'logins', 'logins that belong to two or more accounts',
         (select count(*) || ' (of which ' || count(*) filter (where owned >= 1) || ' own one of them, '
                 || count(*) filter (where owned >= 2) || ' own two or more)'
            from two_logins),
         '0. Such a login sees its OLDEST account in the app, but cannot pay, cancel or update the card for either (ambiguous_account) until it belongs to one account: BILLING_SUPPORT.md section 6'
  union all
  select 18, 0, 'logins', 'accounts with no subscription row at all',
         (select count(*)::text from accounts a
           where a.deleted_at is null and not exists (select 1 from subscriptions s where s.account_id = a.id)),
         '0'
  union all
  -- 5. Founding places
  select 19, 0, 'founding places', 'free | held for a checkout now | stale holds | claimed | forfeited (total)',
         (select free || ' | ' || held || ' | ' || stale || ' | ' || claimed || ' | ' || forfeited
                 || ' (' || total || ')' from slots),
         'total 100. /subscribe shows only "free" as left; stale holds can still be sold, so the real number is free + stale'
  union all
  select 20, 0, 'founding places', 'stale founder holds (an account started checkout, the hold ran out, never paid)',
         (select stale::text from slots),
         'a few is normal: every abandoned checkout leaves one'
  union all
  -- 6. Trials
  select 21, 0, 'trials', 'trials longer than the 14-day rule allows (ending after 23:59:59 Lagos on day 14)',
         (select count(*) || ' (of which ' || count(*) filter (where current_period_end > now()) || ' still running)'
            from live s
           where s.status = 'trialing'
             and s.current_period_end > (((s.created_at at time zone 'Africa/Lagos')::date + 15)::timestamp
                                         at time zone 'Africa/Lagos')),
         '0, unless you extended a trial on purpose'
  union all
  select 22, 0, 'trials', 'trials: running | ended and not paid',
         (select count(*) filter (where current_period_end > now()) || ' | '
                 || count(*) filter (where current_period_end <= now())
            from live where status = 'trialing'),
         'for your own picture'
  union all
  -- 7. This database
  select 23, 0, 'database', 'trial gate (0066) | self-serve billing (0067)',
         (select case when has_0066 then 'applied' else 'not yet' end || ' | '
                 || case when has_0067 then 'applied' else 'not yet' end from gate),
         'tells you which "good" answers apply. The web switch BILLING_SELF_SERVE (Vercel) is not visible from here'
  union all
  select 24, 0, 'database', 'checked at',
         to_char(now() at time zone 'Africa/Lagos', 'Dy DD Mon YYYY HH24:MI') || ' Lagos', ''
) rows
order by n, sub;
