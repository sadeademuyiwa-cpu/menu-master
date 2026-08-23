-- ============================================================================
-- MENU MASTER NG — do the ids in the test page match the real fixtures?
--
-- READ ONLY. Selects only. Nothing written, created or dropped.
--
-- The control failed with "Ingredient does not belong to this account".
-- That fires when the ingredient's account differs from the business's
-- account, OR when the ingredient row is not visible at all (NULL).
-- This tells us which, and whether the page is simply using a stale id.
-- ============================================================================

do $$
declare
  ua uuid; acca uuid; biza uuid; inga uuid; v text;
  page_biz uuid := '1308b876-ac91-4cda-b40f-b102936529f2';
  page_ing uuid := '2cfe32c7-1cb1-4fdd-b98b-8e506de5aa94';
begin
  select id   into ua   from auth.users where lower(email)='ownera@boundary.test';
  select id   into acca from accounts   where name='Boundary A';
  select b.id into biza from businesses b where b.account_id=acca;
  select i.id into inga from ingredients i
    where i.account_id=acca and i.name='Rice (local)';

  perform set_config('mm.true_biz', coalesce(biza::text,'MISSING'), false);
  perform set_config('mm.true_ing', coalesce(inga::text,'MISSING'), false);
  perform set_config('mm.biz_match', (biza = page_biz)::text, false);
  perform set_config('mm.ing_match', (inga = page_ing)::text, false);

  -- What account does each id ACTUALLY belong to, read with full privilege?
  perform set_config('mm.page_biz_acct',
    coalesce((select a.name from business_settings bs join accounts a on a.id=bs.account_id
              where bs.business_id = page_biz), 'NO SETTINGS ROW FOR THIS BUSINESS'), false);
  perform set_config('mm.page_ing_acct',
    coalesce((select a.name from ingredients i join accounts a on a.id=i.account_id
              where i.id = page_ing), 'INGREDIENT ID DOES NOT EXIST'), false);

  -- Now as owner A: can she see that ingredient row through RLS at all?
  perform set_config('request.jwt.claim.sub', ua::text, true);
  execute 'set local role authenticated';

  begin v := (select count(*)::text from ingredients where id = page_ing);
  exception when others then v := 'ERROR '||sqlstate||': '||sqlerrm; end;
  perform set_config('mm.ing_visible_to_A', v, false);

  begin v := coalesce(fn_ingredient_unit_cost(inga, biza)::text,'NULL');
  exception when others then v := 'ERROR '||sqlstate||': '||sqlerrm; end;
  perform set_config('mm.rpc_true_ids', v, false);

  execute 'reset role';
end $$;

select current_setting('mm.ing_match',        true) as page_ingredient_id_correct,
       current_setting('mm.biz_match',        true) as page_business_id_correct,
       current_setting('mm.page_ing_acct',    true) as page_ingredient_belongs_to,
       current_setting('mm.page_biz_acct',    true) as page_business_belongs_to,
       current_setting('mm.ing_visible_to_A', true) as ingredient_rows_A_can_see,
       current_setting('mm.rpc_true_ids',     true) as rpc_with_TRUE_ids_as_A,
       current_setting('mm.true_ing',         true) as true_ingredient_id,
       current_setting('mm.true_biz',         true) as true_business_id;
