-- ============================================================================
-- 0064 ROLLBACK: drop fn_menu_prices. Back at 0063.
--
-- Sales staff then see "No price yet" on the New sale menu again and type
-- each price, as before 0064. Nothing is lost: the function stores nothing,
-- and every price is still in recipe_prices. Roll the app back first if it
-- calls fn_menu_prices without falling back.
-- ============================================================================
drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0064 rollback ABORT: this executor is not honouring transaction control. '
      'Run it with psql --single-transaction.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if to_regprocedure('public.fn_menu_prices()') is null then
    raise exception '0064 rollback: fn_menu_prices does not exist; 0064 is not applied.';
  end if;
end
$$;

drop function if exists fn_menu_prices();

do $$
begin
  if (select count(*) from pg_policies where schemaname='public') <> 118 then
    raise exception '0064 rollback FAILED: policy count is %, expected 118.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 98 then
    raise exception '0064 rollback FAILED: fn_* count is %, expected 98.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  raise notice '0064 rollback OK: back at 0063. Sales staff no longer see selling prices.';
end
$$;
