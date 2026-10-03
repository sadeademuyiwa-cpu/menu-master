-- ============================================================================
-- REPAIR: a paid subscription still carrying its trial's end date
--
-- 0051 stops this happening again. It does not reach back: a subscription paid
-- for BEFORE 0051 still holds the date the trial would have ended.
--
-- The corrected date is not invented. It is read from the account's own
-- billing_events -- the paid_at of the charge Paystack sent us -- so the period
-- is a month from when the customer actually paid, exactly as 0051 computes it
-- for every payment from now on.
--
-- Run with:  psql "<session pooler>" --single-transaction -v ON_ERROR_STOP=1 \
--                 -f deploy/runbook/REPAIR_STALE_PAID_PERIOD.sql
--
-- IT PREVIEWS BY DEFAULT AND WRITES NOTHING. To apply, add -v apply=yes.
-- ============================================================================

-- psql-only by design (it carries the transaction guard), so psql
-- meta-commands are used here to turn -v apply=yes into something a DO block
-- can read. A psql variable is not a GUC, and reading it as one silently made
-- the apply flag do nothing.
\if :{?apply}
\else
  \set apply no
\endif
select set_config('my.apply', :'apply', false) as apply_mode;

drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception 'ABORT: this executor is not honouring transaction control. '
      'Run it with psql --single-transaction.';
  end if;
end
$guard$;
drop table _tx_probe;

-- Candidates, by the exact signature of the fault: a PAID plan, currently
-- active, whose period end is still precisely the trial's end date.
create temp table _repair as
select s.account_id,
       s.plan_id,
       s.current_period_end                       as period_now,
       s.trial_ends_at,
       (select max((e.payload #>> '{data,paid_at}')::timestamptz)
          from billing_events e
         where e.account_id = s.account_id
           and e.event_type = 'charge.success'
           and e.status = 'applied'
           and nullif(e.payload #>> '{data,paid_at}','') is not null) as paid_at
  from subscriptions s
  join plans p on p.id = s.plan_id
 where s.status = 'active'
   and p.price_tier <> 'trial'
   and s.trial_ends_at is not null
   and s.current_period_end = s.trial_ends_at;

alter table _repair add column period_fixed timestamptz;
update _repair set period_fixed = paid_at + interval '1 month' where paid_at is not null;

select account_id, plan_id,
       period_now::date   as "period end now",
       paid_at::date      as "actually paid on",
       period_fixed::date as "period end should be",
       case when paid_at is null then 'NO PAID CHARGE RECORDED -- left alone'
            else 'will be corrected' end as verdict
  from _repair order by account_id;

do $$
declare v_apply boolean := coalesce(nullif(current_setting('my.apply', true),''),'no') = 'yes';
        v_n int; v_skip int;
begin
  select count(*) filter (where period_fixed is not null),
         count(*) filter (where period_fixed is null)
    into v_n, v_skip from _repair;

  if v_skip > 0 then
    raise notice '% subscription(s) have no recorded charge.success with a paid_at. '
                 'They are NOT touched: there is no evidence of when they paid, and '
                 'a date with no evidence behind it is exactly what this repairs.', v_skip;
  end if;

  if not v_apply then
    raise notice 'PREVIEW ONLY -- nothing written. % row(s) would be corrected. '
                 'Re-run with -v apply=yes to apply.', v_n;
    return;
  end if;

  update subscriptions s
     set current_period_end = r.period_fixed
    from _repair r
   where r.account_id = s.account_id
     and r.period_fixed is not null
     -- re-checked at write time: nothing else may have moved it meanwhile
     and s.current_period_end = r.period_now;

  get diagnostics v_n = row_count;
  raise notice 'REPAIRED % subscription(s).', v_n;
end
$$;

select s.account_id, p.name, s.status,
       s.current_period_end::date as "period end after"
  from subscriptions s join plans p on p.id = s.plan_id
 where s.account_id in (select account_id from _repair)
 order by s.account_id;

drop table _repair;
