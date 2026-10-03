-- Rollback for 0032. Restores the 0028 entitlement definition verbatim and the
-- 0004 blanket policies. The function signature never changed, so the 60
-- original policies are untouched in both directions.
alter table subscriptions drop constraint if exists ck_subscriptions_period_present;
drop view if exists v_billing_anomalies;

do $$
declare t text;
begin
  foreach t in array array['ingredient_prices','cost_snapshots','recipe_prices']
  loop
    execute format('drop policy if exists p_%I_select on %I', t, t);
    execute format('drop policy if exists p_%I_insert on %I', t, t);
    execute format('drop policy if exists p_%I_update on %I', t, t);
    execute format('drop policy if exists p_%I_delete on %I', t, t);
    execute format($f$
      create policy p_%1$I on %1$I for all
        using (fn_is_account_member(account_id) and fn_can_see_costs(account_id))
        with check (fn_is_account_member(account_id) and fn_can_see_costs(account_id))
    $f$, t);
  end loop;
end
$$;

create or replace function fn_account_is_entitled(p_account_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from subscriptions s
     where s.account_id = p_account_id
       and ( s.status in ('trialing','active','past_due')
          or (s.status = 'cancelled' and s.current_period_end > now()) )
  );
$$;

drop function if exists fn_my_entitlement_status();
drop function if exists fn_payment_failure_grace();
drop table if exists billing_config;
