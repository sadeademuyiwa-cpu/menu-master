-- ============================================================================
-- MENU MASTER NG
-- 0021 ROLLBACK -- reverses Gate 2 Phase 1 completely
--
-- Run inside an explicit transaction. It refuses unless 0021 is actually in
-- place, and refuses to commit unless the database is back at the exact
-- 40 fn_* / 44 relations / 93 policies baseline.
--
-- WHY THIS IS SAFE
--   0021 changed no read path, moved no costing formula, and dropped nothing.
--   Every legacy column (recipes.portion_qty, business_settings.
--   expected_monthly_units) survived it untouched. So this rollback removes
--   objects; it does not have to restore data.
--
--   It DOES delete any Gate 2 rows that exist -- serving formats, variants,
--   format packaging and the format change log. Preflight row 11 proved
--   production holds zero tenant rows, so at the time of writing there are
--   none. If Gate 2 data has since been entered, THAT DATA IS LOST. Check
--   before running.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_class
                  where relnamespace='public'::regnamespace
                    and relname='serving_formats') then
    raise exception '0021 rollback FAILED: 0021 is not applied; nothing to reverse.';
  end if;

  if (select count(*) from pg_proc
       where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 47 then
    raise exception '0021 rollback FAILED: expected 47 fn_* functions, found %. '
                    'A later migration is present. Reverse that first.',
      (select count(*) from pg_proc
        where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;

  raise notice '0021 rollback preflight OK. Gate 2 rows about to be removed: '
               '% format(s), % variant(s).',
    (select count(*) from serving_formats), (select count(*) from recipe_variants);
end
$$;

-- 1. triggers this migration placed on PRE-EXISTING tables
drop trigger if exists trg_business_settings_overhead_unit_scope on business_settings;
drop trigger if exists trg_order_lines_variant_valid   on order_lines;
drop trigger if exists trg_sales_entries_variant_valid on sales_entries;
drop trigger if exists trg_recipe_lines_no_double_count on recipe_lines;

-- 2. the constraint added to a pre-existing table
alter table cost_snapshots drop constraint if exists chk_complete_requires_resolution;

-- 3. the columns added to pre-existing tables
alter table cost_snapshots
  drop column if exists variant_id,
  drop column if exists resolved_qty,
  drop column if exists resolved_unit_id,
  drop column if exists basis_used,
  drop column if exists format_packaging_cost;

alter table recipe_prices   drop column if exists variant_id;
alter table order_lines     drop column if exists variant_id;
alter table sales_entries   drop column if exists variant_id;

alter table business_settings
  drop column if exists overhead_basis_qty,
  drop column if exists overhead_basis_unit_id;

-- 4. the four Gate 2 tables (their policies, indexes and triggers go with them)
drop table if exists serving_format_changes;
drop table if exists serving_format_packaging;
drop table if exists recipe_variants;
drop table if exists serving_formats;

-- 5. the seven trigger functions
drop function if exists fn_assert_unit_visible_col();
drop function if exists fn_assert_packaging_item_kind();
drop function if exists fn_log_serving_format_change();
drop function if exists fn_block_format_change_mutation();
drop function if exists fn_reject_variant_on_inactive_format();
drop function if exists fn_assert_sale_variant_valid();
drop function if exists fn_assert_no_packaging_double_count();

-- 6. the enum
drop type if exists variant_costing_basis;

-- 7. F2 -- the composite key added solely for recipe_variants
alter table recipes drop constraint if exists ux_recipes_id_business;

-- ----------------------------------------------------------------------------
-- SELF-CHECK -- refuse to commit unless the baseline is exactly restored
-- ----------------------------------------------------------------------------
do $$
declare v_fns int; v_rels int; v_pols int;
begin
  select count(*) into v_fns from pg_proc
    where pronamespace='public'::regnamespace and proname like 'fn\_%';
  select count(*) into v_rels from pg_class
    where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f');
  select count(*) into v_pols from pg_policies where schemaname='public';

  if v_fns <> 40 or v_rels <> 44 or v_pols <> 93 then
    raise exception '0021 rollback self-check FAILED: % / % / %, expected 40 / 44 / 93.',
      v_fns, v_rels, v_pols;
  end if;

  if not exists (select 1 from pg_proc
                  where pronamespace='public'::regnamespace
                    and proname='fn_assert_unit_visible'
                    and prosrc like '%new.unit_id%') then
    raise exception '0021 rollback self-check FAILED: the 0004 fn_assert_unit_visible '
                    'is missing or altered.';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='recipes'
                    and column_name='portion_qty') then
    raise exception '0021 rollback self-check FAILED: recipes.portion_qty is gone.';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='business_settings'
                    and column_name='expected_monthly_units') then
    raise exception '0021 rollback self-check FAILED: expected_monthly_units is gone.';
  end if;

  if (select count(*) from pg_proc
       where pronamespace='public'::regnamespace
         and proname='fn_create_account_and_business' and pronargs=9) <> 1 then
    raise exception '0021 rollback self-check FAILED: the 0020 RPC is gone.';
  end if;

  raise notice '0021 ROLLBACK OK: back to 40 / 44 / 93; 0004 function, 0020 RPC and '
               'both deprecated legacy columns all intact.';
end
$$;
