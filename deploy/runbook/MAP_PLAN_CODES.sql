-- ============================================================================
-- MAP PAYSTACK PLAN CODES -> plans.provider_plan_code
--
-- Run with:  psql "<session pooler>" --single-transaction -v ON_ERROR_STOP=1 \
--                 -f deploy/runbook/MAP_PLAN_CODES.sql
--
-- NOT the SQL Editor. This file writes four rows and they must land together
-- or not at all: the editor's autocommit will happily leave you with two of
-- four mapped, which is a half-open shop.
--
-- EDIT THE FOUR CODES BELOW FIRST. They are placeholders.
--
-- Test-mode and live-mode plan codes are DIFFERENT. Re-running this with the
-- live codes is the first step of the live switch-over, not an afterthought.
-- ============================================================================

drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception 'ABORT: this executor is not honouring transaction control. '
      'Two of these four updates would commit and two would not. Run it with '
      'psql --single-transaction.';
  end if;
end
$guard$;
drop table _tx_probe;

-- ---------------------------------------------------------------------------
-- The four codes. Replace each PLN_ value.
-- ---------------------------------------------------------------------------
create temp table _codes (plan_id text primary key, code text not null, naira int not null);
insert into _codes values
  ('costing',          'PLN_j5p9kupsu05lkz9',  7500),
  ('trading',          'PLN_ma08b5nju78bfom', 15000),
  ('founding_costing', 'PLN_fy0sypwvmce67wl',  3500),
  ('founding_trading', 'PLN_igp4tj8nbsyznq4',  7500);
-- Owner-supplied, Paystack TEST mode, 2026-09-05. The two N7,500 rows are
-- DIFFERENT plans: costing grants costing only, founding_trading grants Sales.
-- They were transposed twice while being read off the dashboard, which is why
-- the checks above refuse a repeated code rather than trusting the list.

-- ---------------------------------------------------------------------------
-- Refuse before writing anything
-- ---------------------------------------------------------------------------
do $$
declare v_dupe text; v_bad text;
begin
  if exists (select 1 from _codes where code like 'PLN_REPLACE_ME%') then
    raise exception 'ABORT: the placeholder codes are still in this file.';
  end if;

  -- FOUR PLANS, FOUR DIFFERENT CODES. Two plans sharing one code is the error
  -- that matters most here: it means one Paystack plan would be selling two
  -- different entitlements at two different prices.
  select string_agg(code, ', ') into v_dupe
    from (select code from _codes group by code having count(*) > 1) d;
  if v_dupe is not null then
    raise exception 'ABORT: the same Paystack plan code is used more than once: %. '
      'Each plan needs its own code -- check the Paystack dashboard again.', v_dupe;
  end if;

  -- and the amount we hold must match the amount the plan was created for
  select string_agg(c.plan_id || ' expects N' || c.naira ||
                    ' but plans says N' || (p.price_kobo / 100), '; ')
    into v_bad
    from _codes c join plans p on p.id = c.plan_id
   where p.price_kobo <> c.naira * 100;
  if v_bad is not null then
    raise exception 'ABORT: price mismatch -- %', v_bad;
  end if;

  if (select count(*) from _codes c join plans p on p.id = c.plan_id and p.is_active) <> 4 then
    raise exception 'ABORT: not all four plans exist and are active.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Write. ux_plans_provider_plan_code (0030) is the last line of defence: a
-- duplicate raises 23505 here and the whole transaction rolls back.
-- ---------------------------------------------------------------------------
update plans p set provider_plan_code = c.code
  from _codes c where p.id = c.plan_id;

do $$
declare n int;
begin
  select count(*) into n from plans p join _codes c
    on c.plan_id = p.id and c.code = p.provider_plan_code;
  if n <> 4 then
    raise exception 'FAILED: % of 4 plans mapped.', n;
  end if;
  if (select count(distinct provider_plan_code) from plans
       where provider_plan_code is not null) <> 4 then
    raise exception 'FAILED: the four codes are not distinct in the table.';
  end if;
  if (select provider_plan_code from plans where id='trial') is not null then
    raise exception 'FAILED: the trial plan must carry no Paystack code -- it is free.';
  end if;
  raise notice 'MAPPED OK: four plans, four distinct Paystack codes, trial unmapped.';
end
$$;

drop table _codes;

select id, name, price_kobo, coalesce(provider_plan_code, '(none)') as paystack_code
  from plans order by id;
