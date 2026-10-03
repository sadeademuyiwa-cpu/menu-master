-- Rollback for 0034. Restores the pre-0034 blending behaviour and the 21-column
-- view exactly as 0033 created it. Drop order matters: the view reads the basis
-- function, and the function returns the composite type.
begin;

-- Restored verbatim from 0012_gate1_authorization_hardening.sql, the migration
-- that last defined it, so the rollback reproduces the original definition
-- byte for byte and a definition fingerprint matches the pre-0034 baseline.
create or replace function fn_ingredient_unit_cost(
  p_ingredient_id uuid,
  p_business_id   uuid,
  p_as_of         date default current_date
)
returns numeric
language plpgsql stable security definer set search_path = public
as $$
declare
  v_account_id uuid;
  v_ing_acct   uuid;
  v_window     integer;
  v_cost       numeric;
begin
  select account_id, wavg_window_days into v_account_id, v_window
  from business_settings where business_id = p_business_id;

  if v_account_id is null then
    return null;                                  -- unknown business
  end if;

  perform fn_require_cost_access(v_account_id);   -- AUTHORIZATION

  -- The ingredient must belong to the same account as the business.
  -- This blocks the mix-and-match parameter attack.
  select account_id into v_ing_acct from ingredients where id = p_ingredient_id;
  if v_ing_acct is distinct from v_account_id then
    raise exception 'Ingredient does not belong to this account'
      using errcode = '42501';
  end if;

  select sum(amount) / nullif(sum(qty_base), 0) into v_cost
  from ingredient_prices
  where ingredient_id = p_ingredient_id
    and account_id    = v_account_id
    and reversed_at is null
    and effective_date <= p_as_of
    and effective_date >  p_as_of - (v_window || ' days')::interval;

  if v_cost is null then
    select unit_cost into v_cost
    from ingredient_prices
    where ingredient_id = p_ingredient_id
      and account_id    = v_account_id
      and reversed_at is null
      and effective_date <= p_as_of
    order by effective_date desc, created_at desc
    limit 1;
  end if;

  return v_cost;   -- NULL still means not entered. Never zero.
end;
$$;

drop view if exists v_recipe_line_costs;

create view v_recipe_line_costs with (security_invoker = on) as
select
  rl.id as line_id, rl.recipe_id, rl.account_id, r.business_id,
  rl.ingredient_id, rl.sub_recipe_id,
  coalesce(i.name, sr.name) as item_name, i.kind as item_kind,
  rl.is_cost_bearing, rl.exclusion_reason,
  rl.qty as recipe_qty, u.code as recipe_unit, bu.code as base_unit,
  fn_resolve_qty_to_base(rl.ingredient_id, rl.qty, rl.unit_id) as base_qty,
  fn_ingredient_usable_unit_cost(rl.ingredient_id, r.business_id) as unit_cost,
  case when rl.is_cost_bearing then
    fn_resolve_qty_to_base(rl.ingredient_id, rl.qty, rl.unit_id)
      * fn_ingredient_usable_unit_cost(rl.ingredient_id, r.business_id)
  end as line_cost,
  case when w.qty_base > 0 then w.qty_base       else l.qty_base       end as purchase_qty_base,
  case when w.qty_base > 0 then w.amount         else l.amount         end as purchase_amount,
  case when w.qty_base > 0 then w.last_date      else l.effective_date end as purchase_date,
  case when w.qty_base > 0 then w.purchase_count
       when l.qty_base is not null then 1 else 0 end                       as purchase_count,
  case
    when not rl.is_cost_bearing                                              then 'excluded'
    when rl.sub_recipe_id is not null                                        then 'sub_recipe'
    when fn_resolve_qty_to_base(rl.ingredient_id, rl.qty, rl.unit_id) is null then 'missing_conversion'
    when fn_ingredient_usable_unit_cost(rl.ingredient_id, r.business_id) is null then 'missing_price'
    else                                                                          'ok'
  end as problem
from recipe_lines rl
join recipes r on r.id = rl.recipe_id and r.deleted_at is null
left join ingredients i on i.id = rl.ingredient_id
left join recipes sr on sr.id = rl.sub_recipe_id
left join units u on u.id = rl.unit_id
left join units bu on bu.id = i.base_unit_id
left join business_settings bs on bs.business_id = r.business_id
left join lateral (
  select sum(ip.qty_base) as qty_base, sum(ip.amount) as amount,
         max(ip.effective_date) as last_date, count(*)::int as purchase_count
    from ingredient_prices ip
   where ip.ingredient_id = rl.ingredient_id and ip.account_id = r.account_id
     and ip.reversed_at is null and ip.effective_date <= current_date
     and ip.effective_date > current_date - (bs.wavg_window_days || ' days')::interval
) w on true
left join lateral (
  select ip.qty_base, ip.amount, ip.effective_date
    from ingredient_prices ip
   where ip.ingredient_id = rl.ingredient_id and ip.account_id = r.account_id
     and ip.reversed_at is null and ip.effective_date <= current_date
   order by ip.effective_date desc, ip.created_at desc limit 1
) l on true;

grant select on v_recipe_line_costs to authenticated;

drop function if exists fn_ingredient_cost_basis(uuid, uuid, date);
drop type if exists ingredient_cost_basis;

commit;
