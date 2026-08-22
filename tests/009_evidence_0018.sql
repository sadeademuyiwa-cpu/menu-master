-- ============================================================================
-- MENU MASTER NG
-- 009: evidence for migration 0018
--
-- DISPOSABLE PROJECT ONLY. Never run against production.
--
-- Covers verification items 2-9. Items 1 (pre-flight), 10 (regression suites)
-- and 11 (idempotence) are separate runs.
--
-- Mostly read-only. Three deliberate exceptions, all self-reversing:
--   item 8  changes Boundary B's subscription and changes it straight back
--   item 9  creates a probe table and drops it
--   items 2/3 ATTEMPT a TRUNCATE that must fail; if it ever succeeds the
--           verdict says so loudly and the fixtures are gone, which is
--           itself the finding.
--
-- Emits ONE result set: the SQL Editor renders only the last.
-- ============================================================================

do $$
declare
  ua uuid; ub uuid; acca uuid; accb uuid; biza uuid; inga uuid;
  v text; n integer;
begin
  select id into ua   from auth.users where lower(email)='ownera@boundary.test';
  select id into ub   from auth.users where lower(email)='ownerb@boundary.test';
  select id into acca from accounts where name='Boundary A';
  select id into accb from accounts where name='Boundary B';
  select b.id into biza from businesses b where b.account_id=acca;
  select i.id into inga from ingredients i
    join ingredient_prices p on p.ingredient_id=i.id where i.account_id=acca limit 1;

  -- ---- item 2: anon TRUNCATE must be refused --------------------------------
  begin
    set local role anon;
    execute 'truncate ingredient_prices cascade';
    v := '>>> SUCCEEDED — TABLE EMPTIED';
  exception when insufficient_privilege then v := 'refused: permission denied';
            when others then v := 'refused: '||sqlstate||' '||sqlerrm;
  end;
  reset role;
  perform set_config('mm.i2', v, false);

  -- ---- item 3: authenticated TRUNCATE must be refused -----------------------
  begin
    perform set_config('request.jwt.claim.sub', ua::text, true);
    set local role authenticated;
    execute 'truncate ingredient_prices cascade';
    v := '>>> SUCCEEDED — TABLE EMPTIED';
  exception when insufficient_privilege then v := 'refused: permission denied';
            when others then v := 'refused: '||sqlstate||' '||sqlerrm;
  end;
  reset role;
  perform set_config('mm.i3', v, false);

  -- ---- item 6: RLS still blocks cross-account read AND write ----------------
  begin
    perform set_config('request.jwt.claim.sub', ub::text, true);
    set local role authenticated;
    select count(*) into n from ingredient_prices where account_id = acca;
    v := n || ' of A''s price rows visible to owner B';
  exception when others then v := 'error '||sqlstate||': '||sqlerrm;
  end;
  reset role;
  perform set_config('mm.i6r', v, false);

  begin
    perform set_config('request.jwt.claim.sub', ub::text, true);
    set local role authenticated;
    execute format('insert into ingredients (account_id, name) values (%L, %L)', acca, 'B injected');
    v := '>>> INSERT INTO A''S ACCOUNT SUCCEEDED';
  exception when others then v := 'refused: '||sqlstate;
  end;
  reset role;
  perform set_config('mm.i6w', v, false);

  -- ---- item 7: costing functions enforce their own authorization -----------
  begin
    perform set_config('request.jwt.claim.sub', ub::text, true);
    set local role authenticated;
    v := 'RETURNED ' || coalesce(fn_ingredient_unit_cost(inga, biza)::text,'null');
  exception when others then v := 'refused: '||sqlstate||' '||sqlerrm;
  end;
  reset role;
  perform set_config('mm.i7b', v, false);

  begin
    perform set_config('request.jwt.claim.sub', '', true);
    set local role anon;
    v := 'RETURNED ' || coalesce(fn_ingredient_unit_cost(inga, biza)::text,'null');
  exception when others then v := 'refused: '||sqlstate;
  end;
  reset role;
  perform set_config('mm.i7a', v, false);

  -- ---- item 8: the service_role billing path, then put it back -------------
  -- The SQL Editor runs as service context, so this exercises the same branch
  -- the Paystack webhook will.
  --
  -- Clear the JWT subject FIRST, outside any exception block. A caught
  -- exception rolls back its block's set_config, so an end-user subject set
  -- during items 6-7 can survive into here and make fn_is_service_context()
  -- correctly return false -- which reads as a billing failure that isn't one.
  perform set_config('request.jwt.claim.sub', '', false);
  reset role;

  begin
    v := (fn_set_subscription_plan(accb, 'trading', 'active', null, 'EVIDENCE-0018')->>'rows_updated');
    v := 'rows_updated=' || v || ' now=' ||
         (select plan_id||'/'||status from subscriptions where account_id=accb);
    perform fn_set_subscription_plan(accb, 'trial', 'trialing', null, null);
    v := v || ' then restored to ' ||
         (select plan_id||'/'||status from subscriptions where account_id=accb);
  exception when others then v := 'FAILED: '||sqlstate||' '||sqlerrm;
  end;
  perform set_config('mm.i8', v, false);

  -- ---- item 9: a NEW table must inherit nothing ----------------------------
  execute 'create table if not exists _mmng_probe_0018 (id int)';
  select coalesce(string_agg(distinct grantee||':'||privilege_type, ', '), 'NONE')
    into v
    from information_schema.role_table_grants
   where table_name = '_mmng_probe_0018' and grantee in ('anon','authenticated');
  execute 'drop table _mmng_probe_0018';
  perform set_config('mm.i9', v, false);
end
$$;

select * from (
  values
  ('2  anon TRUNCATE',            current_setting('mm.i2',true),
     case when current_setting('mm.i2',true) like 'refused%' then 'PASS' else 'FAIL' end),
  ('3  authenticated TRUNCATE',   current_setting('mm.i3',true),
     case when current_setting('mm.i3',true) like 'refused%' then 'PASS' else 'FAIL' end),
  ('4  anon table grants',
     (select coalesce(string_agg(distinct table_name, ', ' order by table_name),'NONE')
        from information_schema.role_table_grants
       where table_schema='public' and grantee='anon'),
     case when (select coalesce(string_agg(distinct table_name, ',' order by table_name),'')
                  from information_schema.role_table_grants
                 where table_schema='public' and grantee='anon')
              = 'catalog_categories,catalog_ingredients,plan_features,plans,units'
          then 'PASS' else 'FAIL' end),
  ('4b anon privilege types',
     (select coalesce(string_agg(distinct privilege_type,',' order by privilege_type),'NONE')
        from information_schema.role_table_grants where table_schema='public' and grantee='anon'),
     case when (select coalesce(string_agg(distinct privilege_type,',' order by privilege_type),'')
                  from information_schema.role_table_grants
                 where table_schema='public' and grantee='anon') = 'SELECT'
          then 'PASS' else 'FAIL' end),
  ('5  authenticated privileges',
     (select coalesce(string_agg(distinct privilege_type,',' order by privilege_type),'NONE')
        from information_schema.role_table_grants where table_schema='public' and grantee='authenticated'),
     case when (select coalesce(string_agg(distinct privilege_type,',' order by privilege_type),'')
                  from information_schema.role_table_grants
                 where table_schema='public' and grantee='authenticated') = 'DELETE,INSERT,SELECT,UPDATE'
          then 'PASS' else 'FAIL' end),
  ('5b subscriptions = SELECT only',
     (select coalesce(string_agg(privilege_type,',' order by privilege_type),'NONE')
        from information_schema.role_table_grants
       where table_name='subscriptions' and grantee='authenticated'),
     case when (select coalesce(string_agg(privilege_type,',' order by privilege_type),'')
                  from information_schema.role_table_grants
                 where table_name='subscriptions' and grantee='authenticated') = 'SELECT'
          then 'PASS' else 'FAIL' end),
  ('6  RLS cross-account READ',   current_setting('mm.i6r',true),
     case when current_setting('mm.i6r',true) like '0 of%' then 'PASS' else 'FAIL' end),
  ('6b RLS cross-account WRITE',  current_setting('mm.i6w',true),
     case when current_setting('mm.i6w',true) like 'refused%' then 'PASS' else 'FAIL' end),
  ('7  costing fn vs owner B',    current_setting('mm.i7b',true),
     case when current_setting('mm.i7b',true) like 'refused%' then 'PASS' else 'FAIL' end),
  ('7b costing fn vs anon',       current_setting('mm.i7a',true),
     case when current_setting('mm.i7a',true) like 'refused%' then 'PASS' else 'FAIL' end),
  ('8  service_role billing path',current_setting('mm.i8',true),
     case when current_setting('mm.i8',true) like 'rows_updated=1%' then 'PASS' else 'FAIL' end),
  ('9  new table inherits',       current_setting('mm.i9',true),
     case when current_setting('mm.i9',true) = 'NONE' then 'PASS' else 'FAIL' end)
) as t(item, observed, verdict);
