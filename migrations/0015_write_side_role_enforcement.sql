-- ============================================================================
-- MENU MASTER NG
-- 0015: write-side role enforcement
--
-- GATE 1 CLOSURE, item A4.
--
-- THE DEFECT
--   0001 applied one blanket policy to every tenant table:
--       create policy p_<t> on <t> for all
--         using (fn_is_account_member(account_id))
--         with check (fn_is_account_member(account_id));
--   Membership alone therefore granted INSERT, UPDATE and DELETE on everything.
--   Read access was role-aware from 0004 onward; write access never was. A
--   kitchen user could delete recipes, edit business settings and change target
--   margins. Gate 1 fixed only memberships and subscriptions -- the two tables
--   that confer authority. This closes the remaining 21.
--
--   Measured, not assumed: 24 tables carried the blanket policy, 0012 re-scoped
--   memberships and subscriptions, 0004 cost-gated ingredient_prices and
--   recipe_prices. 21 remained.
--
-- THE MODEL (founder rulings, Gate 1 closure)
--   owner       full business control
--   manager     operational management; no ownership or security administration
--   kitchen     recipe/production operations only; no financial administration
--   sales       sales/order/customer operations only; cannot touch costing
--               history, recipe costing or protected settings
--   accountant  financial, purchasing, costing and reporting; no recipe or
--               production administration, no ownership or security control
--
-- NOTES ON TWO DELIBERATE RULINGS
--   * channels: manager MAY set channel-level target margins (legitimate
--     operational pricing). The business-wide default in business_settings
--     stays owner-only, so channel access is not a back door to the global
--     default.
--   * ingredients.purchase_yield_pct and ingredient_unit_conversions.qty_in_base
--     are production facts that move cost. Kitchen keeps INSERT/UPDATE on them
--     because the people who know the yields must be able to record them.
--     Kitchen gains no other financial permission, and every change still
--     writes an auditable snapshot through the 0008 recompute triggers.
--
-- SELECT is unchanged. Cost-bearing tables stay gated by fn_can_see_costs
-- (0004); this migration governs writes only.
--
-- ADDITIVE. No earlier migration is rewritten. Idempotent.
-- ============================================================================

do $$
declare
  spec record;
  v_roles text;
begin
  for spec in
    select * from (values
      --  table                          INSERT                                        UPDATE                                        DELETE
      ('businesses',                  array['owner'],                               array['owner'],                               array[]::text[]),
      ('locations',                   array['owner','manager'],                     array['owner','manager'],                     array['owner','manager']),
      ('ingredient_categories',       array['owner','manager','kitchen'],           array['owner','manager','kitchen'],           array['owner','manager']),
      ('ingredients',                 array['owner','manager','kitchen'],           array['owner','manager','kitchen'],           array['owner']),
      ('ingredient_unit_conversions', array['owner','manager','kitchen'],           array['owner','manager','kitchen'],           array['owner','manager']),
      ('suppliers',                   array['owner','manager','accountant'],        array['owner','manager','accountant'],        array['owner','manager']),
      ('business_settings',           array[]::text[],                              array['owner'],                               array[]::text[]),
      ('costing_method_changes',      array['owner'],                               array[]::text[],                              array[]::text[]),
      ('recipes',                     array['owner','manager','kitchen'],           array['owner','manager','kitchen'],           array['owner']),
      ('recipe_lines',                array['owner','manager','kitchen'],           array['owner','manager','kitchen'],           array['owner','manager','kitchen']),
      ('labour_rates',                array['owner','manager','accountant'],        array['owner','manager','accountant'],        array['owner','manager']),
      ('recipe_labour',               array['owner','manager','kitchen'],           array['owner','manager','kitchen'],           array['owner','manager','kitchen']),
      ('overhead_items',              array['owner','manager','accountant'],        array['owner','manager','accountant'],        array['owner','manager']),
      ('channels',                    array['owner','manager'],                     array['owner','manager'],                     array['owner']),
      ('purchases',                   array['owner','manager','accountant'],        array['owner','manager','accountant'],        array['owner','manager','accountant']),
      ('purchase_lines',              array['owner','manager','accountant'],        array['owner','manager','accountant'],        array['owner','manager','accountant']),
      ('customers',                   array['owner','manager','sales'],             array['owner','manager','sales'],             array['owner','manager']),
      ('orders',                      array['owner','manager','sales'],             array['owner','manager','sales'],             array['owner','manager']),
      ('order_lines',                 array['owner','manager','sales'],             array['owner','manager','sales'],             array['owner','manager','sales']),
      ('sales_entries',               array['owner','manager','sales'],             array[]::text[],                              array[]::text[]),
      ('period_closes',               array['owner','accountant'],                  array[]::text[],                              array[]::text[])
    ) as t(tbl, ins_roles, upd_roles, del_roles)
  loop
    -- Retire the blanket policy from 0001.
    execute format('drop policy if exists p_%I on %I', spec.tbl, spec.tbl);
    execute format('drop policy if exists p_%I_select on %I', spec.tbl, spec.tbl);
    execute format('drop policy if exists p_%I_insert on %I', spec.tbl, spec.tbl);
    execute format('drop policy if exists p_%I_update on %I', spec.tbl, spec.tbl);
    execute format('drop policy if exists p_%I_delete on %I', spec.tbl, spec.tbl);

    -- SELECT: unchanged. Any member of the account may read; cost-bearing
    -- tables remain separately gated by fn_can_see_costs.
    execute format(
      'create policy p_%I_select on %I for select using (fn_is_account_member(account_id))',
      spec.tbl, spec.tbl);

    if array_length(spec.ins_roles,1) is not null then
      v_roles := array_to_string(spec.ins_roles, ''',''');
      execute format(
        'create policy p_%I_insert on %I for insert
           with check (fn_is_account_member(account_id)
                       and fn_has_account_role(account_id, array[''%s'']::member_role[]))',
        spec.tbl, spec.tbl, v_roles);
    end if;

    if array_length(spec.upd_roles,1) is not null then
      v_roles := array_to_string(spec.upd_roles, ''',''');
      execute format(
        'create policy p_%I_update on %I for update
           using      (fn_is_account_member(account_id)
                       and fn_has_account_role(account_id, array[''%s'']::member_role[]))
           with check (fn_is_account_member(account_id)
                       and fn_has_account_role(account_id, array[''%s'']::member_role[]))',
        spec.tbl, spec.tbl, v_roles, v_roles);
    end if;

    if array_length(spec.del_roles,1) is not null then
      v_roles := array_to_string(spec.del_roles, ''',''');
      execute format(
        'create policy p_%I_delete on %I for delete
           using (fn_is_account_member(account_id)
                  and fn_has_account_role(account_id, array[''%s'']::member_role[]))',
        spec.tbl, spec.tbl, v_roles);
    end if;
  end loop;
end
$$;

-- ----------------------------------------------------------------------------
-- Tables with NO write policy at all, by design:
--   business_settings  INSERT/DELETE  one row per business, created by
--                      onboarding (SECURITY DEFINER). Deleting it would break
--                      costing outright.
--   costing_method_changes  UPDATE/DELETE  append-only audit of a dated event.
--   sales_entries      UPDATE/DELETE  immutable from insert (0014). Correction
--                      is fn_void_sales_entry.
--   period_closes      UPDATE/DELETE  a closed period never silently changes.
--   businesses         DELETE  cascades every financial record. Retirement is
--                      deleted_at, not DROP.
--
-- SECURITY DEFINER functions (onboarding, posting, voting, snapshotting) run as
-- the definer and are unaffected by these policies. They carry their own
-- authorization from 0012, which remains the enforcement point for those paths.
-- ----------------------------------------------------------------------------
