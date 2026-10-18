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
-- Works on 0064 and later. Nothing here depends on 0066 or 0067; where those
-- change what a healthy answer is, the "good" column says so.
-- ============================================================================
with
ev as (
  select e.*,
         coalesce(e.account_id,
                  case when e.payload #>> '{data,metadata,account_id}'
                            ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       then (e.payload #>> '{data,metadata,account_id}')::uuid end) as acct,
         nullif(coalesce(e.payload #>> '{data,subscription_code}',
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
charges as (
  select acct,
         coalesce(case when payload #>> '{data,paid_at}' ~ '^\d{4}-\d{2}-\d{2}'
                       then (payload #>> '{data,paid_at}')::timestamptz end, received_at) as paid,
         lag(coalesce(case when payload #>> '{data,paid_at}' ~ '^\d{4}-\d{2}-\d{2}'
                           then (payload #>> '{data,paid_at}')::timestamptz end, received_at))
           over (partition by acct
                 order by coalesce(case when payload #>> '{data,paid_at}' ~ '^\d{4}-\d{2}-\d{2}'
                                        then (payload #>> '{data,paid_at}')::timestamptz end, received_at)) as prev
    from ev
   where event_type = 'charge.success' and signature_valid and acct is not null
)
select n, sub, section, item, value, good from (
  -- 1. Paystack's notices
  select 1 as n, 0 as sub, 'Paystack notices' as section, 'all billing events, by result' as item,
         coalesce((select string_agg(status || '=' || c, ', ' order by status)
                     from (select status, count(*) as c from billing_events group by status) x), 'none yet') as value,
         'mostly applied; a few ignored is normal (event types we do not act on)' as good
  union all
  select 2, row_number() over (order by event_type, status, last_error_code)::int, 'Paystack notices',
         'failed: ' || coalesce(event_type, '(unreadable)') || ' / ' || status || ' / ' || coalesce(last_error_code, '-'),
         c || ' | latest ' || to_char(latest at time zone 'Africa/Lagos', 'Dy DD Mon YYYY HH24:MI') || ' Lagos',
         case when last_error_code = 'no_account'
              then 'no_account: the notice did not say which account it is for. On subscription.* or invoice.payment_failed it means a cancel or failed payment never reached the account (0067 matches these by subscription code)'
              when last_error_code = 'unmapped_plan_code' then 'a Paystack plan code not linked to a plan: MAP_PLAN_CODES.sql'
              else 'look at it with BILLING_SUPPORT.md "Paystack notice failed"' end
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
  -- 2. Paying accounts
  select 4, 0, 'paying accounts', 'paying accounts by status',
         coalesce((select string_agg(status || '=' || c, ', ' order by status)
                     from (select status, count(*) as c from live where status <> 'trialing' group by status) x), 'none'),
         'for your own picture; compare with Paystack -> Subscriptions'
  union all
  select 5, 0, 'paying accounts', 'active or overdue with NO Paystack subscription code stored',
         (select count(*) || ' (active ' || count(*) filter (where status = 'active')
                 || ', overdue ' || count(*) filter (where status = 'past_due') || ')'
            from live where status in ('active', 'past_due') and provider_subscription_code is null),
         '0. Without the code, Cancel plan and Update your card cannot reach Paystack for that account (no_subscription)'
  union all
  select 6, 0, 'paying accounts', 'active or overdue with NO Paystack customer code stored',
         (select count(*)::text from live where status in ('active', 'past_due') and provider_customer_code is null),
         '0'
  union all
  select 7, 0, 'paying accounts', 'active, but the paid-through date passed more than 2 days ago',
         (select count(*)::text from live where status = 'active' and current_period_end < now() - interval '2 days'),
         '0. More than 0: a renewal was charged but not recorded (REPAIR_STALE_PAID_PERIOD.sql). They keep access'
  union all
  select 8, 0, 'paying accounts', 'overdue (a payment failed): still in the grace days | grace over, read-only',
         (select count(*) filter (where current_period_end + fn_payment_failure_grace() > now()) || ' | '
                 || count(*) filter (where current_period_end + fn_payment_failure_grace() <= now())
            from live where status = 'past_due'),
         'any number is possible; each one is a customer to help (BILLING_SUPPORT.md "Failed payment")'
  union all
  select 9, 0, 'paying accounts', 'cancelled: still inside the paid month | month over',
         (select count(*) filter (where current_period_end > now()) || ' | '
                 || count(*) filter (where current_period_end <= now())
            from live where status = 'cancelled'),
         'for your own picture; "inside the paid month" keeps full use until its date'
  union all
  -- 3. Paying twice
  select 10, 0, 'paying twice?', 'accounts with more than one Paystack subscription code seen',
         (select count(*)::text from (select acct from ev where acct is not null and sub_code is not null
                                      group by acct having count(distinct sub_code) > 1) x),
         '0 until owners change plan. After a plan change 2 is normal, but only one may still be active at Paystack'
  union all
  select 11, 0, 'paying twice?', 'accounts with two successful charges less than 25 days apart',
         (select count(distinct acct)::text from charges where prev is not null and paid - prev < interval '25 days'),
         '0, except right after a plan change (the new plan is charged the day they pay)'
  union all
  -- 4. Logins and accounts
  select 12, 0, 'logins', 'logins that belong to two or more accounts',
         (select count(*) || ' (of which ' || count(*) filter (where owned >= 1) || ' own one of them, '
                 || count(*) filter (where owned >= 2) || ' own two or more)'
            from two_logins),
         '0. Such a login sees and pays for its OLDEST account only (BILLING_SUPPORT.md "One login, two accounts")'
  union all
  select 13, 0, 'logins', 'accounts with no subscription row at all',
         (select count(*)::text from accounts a
           where a.deleted_at is null and not exists (select 1 from subscriptions s where s.account_id = a.id)),
         '0'
  union all
  -- 5. Founding places
  select 14, 0, 'founding places', 'free | held for a checkout now | stale holds | claimed | forfeited (total)',
         (select free || ' | ' || held || ' | ' || stale || ' | ' || claimed || ' | ' || forfeited
                 || ' (' || total || ')' from slots),
         'total 100. /subscribe shows only "free" as left; stale holds can still be sold, so the real number is free + stale'
  union all
  select 15, 0, 'founding places', 'stale founder holds (an account started checkout, the hold ran out, never paid)',
         (select stale::text from slots),
         'a few is normal: every abandoned checkout leaves one'
  union all
  -- 6. Trials
  select 16, 0, 'trials', 'trials longer than the 14-day rule allows (ending after 23:59:59 Lagos on day 14)',
         (select count(*) || ' (of which ' || count(*) filter (where current_period_end > now()) || ' still running)'
            from live s
           where s.status = 'trialing'
             and s.current_period_end > (((s.created_at at time zone 'Africa/Lagos')::date + 15)::timestamp
                                         at time zone 'Africa/Lagos')),
         '0, unless you extended a trial on purpose'
  union all
  select 17, 0, 'trials', 'trials: running | ended and not paid',
         (select count(*) filter (where current_period_end > now()) || ' | '
                 || count(*) filter (where current_period_end <= now())
            from live where status = 'trialing'),
         'for your own picture'
  union all
  select 18, 0, 'database', 'checked at',
         to_char(now() at time zone 'Africa/Lagos', 'Dy DD Mon YYYY HH24:MI') || ' Lagos', ''
) rows
order by n, sub;
