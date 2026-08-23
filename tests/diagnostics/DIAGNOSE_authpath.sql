-- ============================================================================
-- MENU MASTER NG — replay owner A's exact authenticated call, server-side
--
-- READ ONLY. It selects, and it calls STABLE functions. It inserts nothing,
-- updates nothing, deletes nothing, creates nothing, drops nothing.
--
-- It impersonates owner A the same way PostgREST does — by setting the JWT
-- subject GUC and switching to the `authenticated` role — then walks the
-- authorization chain one step at a time and reports where it stops.
--
-- All ids are resolved by name/email, so nothing has to be copied by hand.
-- ============================================================================

do $$
declare
  ua uuid; acca uuid; biza uuid; inga uuid;
  v text;
begin
  -- Resolve ids while still privileged.
  select id     into ua   from auth.users  where lower(email) = 'ownera@boundary.test';
  select id     into acca from accounts    where name = 'Boundary A';
  select b.id   into biza from businesses b where b.account_id = acca;
  select i.id   into inga from ingredients i
    where i.account_id = acca and i.name = 'Rice (local)';

  perform set_config('mm.ids',
    format('user=%s account=%s business=%s ingredient=%s',
           coalesce(ua::text,'MISSING'),   coalesce(acca::text,'MISSING'),
           coalesce(biza::text,'MISSING'), coalesce(inga::text,'MISSING')), false);

  -- Was the Gate 1 closure batch (PART 5) actually applied?
  perform set_config('mm.part5',
    format('require_cost_access=%s void_order=%s',
      exists (select 1 from pg_proc where proname = 'fn_require_cost_access'),
      exists (select 1 from pg_proc where proname = 'fn_void_order')), false);

  -- ---- become owner A, exactly as a browser request would ------------------
  perform set_config('request.jwt.claim.sub', ua::text, true);
  execute 'set local role authenticated';

  begin v := coalesce(auth.uid()::text,'NULL');
  exception when others then v := 'ERROR '||sqlstate||': '||sqlerrm; end;
  perform set_config('mm.uid', v, false);

  begin v := fn_is_service_context()::text;
  exception when others then v := 'ERROR '||sqlstate||': '||sqlerrm; end;
  perform set_config('mm.svc', v, false);

  begin v := fn_is_account_member(acca)::text;
  exception when others then v := 'ERROR '||sqlstate||': '||sqlerrm; end;
  perform set_config('mm.mem', v, false);

  begin v := fn_can_see_costs(acca)::text;
  exception when others then v := 'ERROR '||sqlstate||': '||sqlerrm; end;
  perform set_config('mm.cost', v, false);

  -- Can she even see her own price row through RLS?
  begin
    v := (select count(*)::text from ingredient_prices where ingredient_id = inga);
  exception when others then v := 'ERROR '||sqlstate||': '||sqlerrm; end;
  perform set_config('mm.rls', v, false);

  -- The actual call the test page makes.
  begin
    v := coalesce(fn_ingredient_unit_cost(inga, biza)::text,
                  'NULL — returned no value, raised no error');
  exception when others then v := 'ERROR '||sqlstate||': '||sqlerrm; end;
  perform set_config('mm.rpc', v, false);

  execute 'reset role';
end $$;

select
  current_setting('mm.part5', true) as part5_applied,
  current_setting('mm.uid',   true) as auth_uid_seen,
  current_setting('mm.svc',   true) as is_service_context,
  current_setting('mm.mem',   true) as is_account_member,
  current_setting('mm.cost',  true) as can_see_costs,
  current_setting('mm.rls',   true) as own_price_rows_via_rls,
  current_setting('mm.rpc',   true) as rpc_result,
  current_setting('mm.ids',   true) as ids_used;
