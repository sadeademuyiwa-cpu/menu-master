BEGIN;
SET TRANSACTION READ ONLY;

with pre as (
  select 'A. PREFLIGHT' as section, 1 as ord,
         '0031: subscription_changes must NOT already exist' as item,
         case when exists (select 1 from pg_class where relname='subscription_changes')
              then 'REFUSE' else 'OK' end as verdict,
         (exists (select 1 from pg_class where relname='subscription_changes'))::text as detail
  union all
  select 'A. PREFLIGHT', 2, '0032: fn_account_is_entitled must exist',
         case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                            where n.nspname='public' and p.proname='fn_account_is_entitled')
              then 'OK' else 'REFUSE' end,
         (exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                   where n.nspname='public' and p.proname='fn_account_is_entitled'))::text
  union all
  select 'A. PREFLIGHT', 3, '0032: exactly 60 policies must reference it',
         case when count(*) = 60 then 'OK' else 'REFUSE' end, count(*)::text
    from pg_policies
   where schemaname='public'
     and coalesce(qual,'')||coalesce(with_check,'') like '%fn_account_is_entitled%'
  union all
  select 'A. PREFLIGHT', 4, '0032: zero subscriptions may have a NULL current_period_end',
         case when count(*) = 0 then 'OK' else 'REFUSE' end, count(*)::text
    from subscriptions where current_period_end is null
  union all
  select 'A. PREFLIGHT', 5, 'context: total policies in public (expect 105 pre-0031/0032)',
         'INFO', count(*)::text from pg_policies where schemaname='public'
  union all
  select 'A. PREFLIGHT', 6, 'context: total subscription rows',
         'INFO', count(*)::text from subscriptions
),
ev as (
  select b.account_id,
         count(*) filter (where b.signature_valid)                            as signed_events,
         count(*) filter (where b.signature_valid and b.event_type='charge.success') as real_payments,
         max(b.payload #>> '{data,subscription,next_payment_date}')            as np_sub,
         max(b.payload #>> '{data,next_payment_date}')                         as np_top
    from billing_events b group by b.account_id
),
act as (
  select a.id as account_id,
         (select count(*) from businesses  x where x.account_id=a.id and x.deleted_at is null) as businesses,
         (select count(*) from memberships x where x.account_id=a.id) as users,
         (select count(*) from recipes     x where x.account_id=a.id and x.deleted_at is null) as recipes,
         (select count(*) from ingredients x where x.account_id=a.id and x.deleted_at is null) as ingredients,
         (select count(*) from ingredient_prices x where x.account_id=a.id)    as prices_entered,
         (select count(*) from ingredient_unit_conversions x where x.account_id=a.id) as conversions
    from accounts a
),
subs as (
  select 'B. SUBSCRIPTIONS' as section, 100 + row_number() over (order by s.created_at) as ord,
         'account '||s.account_id::text as item,
         case when s.current_period_end is null then 'BLOCKS 0032' else 'ok' end as verdict,
         concat_ws(' | ',
           'status='||s.status,
           'plan='||s.plan_id,
           'created='||s.created_at::date,
           'trial_ends='||coalesce(s.trial_ends_at::date::text,'NULL'),
           'period_end='||coalesce(s.current_period_end::date::text,'NULL'),
           'trial_expired='||coalesce((s.trial_ends_at < now())::text,'unknown'),
           'entitled_now='||fn_account_is_entitled(s.account_id)::text,
           -- The 0032 rule, evaluated WITHOUT applying it: exactly the
           -- predicate the migration installs, so this shows who would lose
           -- write access on deploy day and who would not.
           'entitled_after_0032='||(
                 (s.status='trialing' and s.current_period_end > now())
              or  s.status='active'
              or (s.status='past_due'
                  and (s.current_period_end is null
                       or s.current_period_end + interval '7 days' > now()))
              or (s.status='cancelled' and s.current_period_end > now())
           )::text,
           'payments='||coalesce(e.real_payments,0)::text,
           'signed_events='||coalesce(e.signed_events,0)::text,
           'provider_ref='||case when s.provider_ref is null then 'none' else 'present' end,
           'biz='||coalesce(c.businesses,0)::text,
           'users='||coalesce(c.users,0)::text,
           'recipes='||coalesce(c.recipes,0)::text,
           'ingredients='||coalesce(c.ingredients,0)::text,
           'own_prices='||coalesce(c.prices_entered,0)::text,
           'conversions='||coalesce(c.conversions,0)::text,
           'evidence='||case
             when s.current_period_end is not null                            then 'ok'
             when s.status='trialing' and s.trial_ends_at is not null         then 'derivable_from_trial'
             when coalesce(e.np_sub, e.np_top) is not null                    then 'derivable_from_provider_event'
             when s.provider_ref is not null                                  then 'needs_provider_fetch'
             else                                                                  'no_evidence_manual' end
         ) as detail
    from subscriptions s
    left join ev  e on e.account_id  = s.account_id
    left join act c on c.account_id  = s.account_id
)
select section, item, verdict, detail
from (select * from pre union all select * from subs) z
order by ord;

ROLLBACK;
