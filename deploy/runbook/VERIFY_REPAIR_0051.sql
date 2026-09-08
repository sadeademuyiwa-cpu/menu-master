-- ============================================================================
-- VERIFY THE REPAIR              READ ONLY. Changes nothing.
--
-- Puts the subscription's period end beside the paid_at that Paystack actually
-- sent, so you can see the repaired date came from the event and not from a
-- default, a guess, or the clock at the moment the repair ran.
--
-- Safe to paste into the Supabase SQL Editor.
-- ============================================================================
select s.account_id,
       p.name                                        as plan,
       s.status,
       s.price_kobo,
       ev.paid_at::date                              as "Paystack paid_at",
       s.current_period_end::date                    as "period end now",
       (ev.paid_at + interval '1 month')::date       as "paid_at + 1 month",
       case
         when ev.paid_at is null
           then 'NO EVENT -- nothing to derive from'
         when s.current_period_end = ev.paid_at + interval '1 month'
           then 'CORRECT -- derived from the real payment'
         when s.current_period_end = s.trial_ends_at
           then 'STILL STALE -- this is the trial end date'
         else 'DIFFERENT -- Paystack sent an explicit next_payment_date, which wins'
       end                                           as verdict
  from subscriptions s
  join plans p on p.id = s.plan_id
  left join lateral (
      select max((e.payload #>> '{data,paid_at}')::timestamptz) as paid_at
        from billing_events e
       where e.account_id = s.account_id
         and e.event_type = 'charge.success'
         and e.status = 'applied'
  ) ev on true
 where p.price_tier <> 'trial'
 order by s.account_id;
