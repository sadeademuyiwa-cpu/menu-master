-- Rollback for 0048.
--
-- Restores EXECUTE to PUBLIC on the functions that carried it before this
-- migration -- which is to say, it puts the drift back. It exists because a
-- rollback must be honest about what it undoes, not because there is any
-- reason to run it.
--
-- It does NOT restore fn_frozen_sale_cost's missing membership check: that fix
-- lives in 0045 and is a correctness matter, not a grant.
begin;

grant execute on function fn_ingredient_cost_basis(uuid, uuid, date) to public;
grant execute on function fn_overhead_breakdown(uuid, uuid)         to public;
grant execute on function fn_overhead_problem(uuid, uuid)           to public;
grant execute on function fn_allocate_order_discount(uuid)          to public;
grant execute on function fn_guard_order_discount()                 to public;
grant execute on function fn_order_line_scope()                     to public;
grant execute on function fn_guard_order_lifecycle()                to public;
grant execute on function fn_confirm_order(uuid)                    to public;
grant execute on function fn_frozen_sale_cost(uuid, uuid, uuid)     to public;
grant execute on function fn_variant_cost_components(uuid)          to public;
grant execute on function fn_guard_subscription_changes()           to public;
grant execute on function fn_payment_failure_grace()                to public;

do $$
begin
  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname like 'fn\_%'
         and '=X/postgres' = any(p.proacl::text[])) <> 12 then
    raise exception '0048 rollback FAILED: the previous grant surface was not restored exactly.';
  end if;
  raise notice '0048 rollback OK: the pre-0048 grant surface is back, drift included.';
end
$$;

commit;
