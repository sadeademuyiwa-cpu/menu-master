-- ============================================================================
-- 0022 ROLLBACK -- removes only what the backfill created
--
-- Deletes the Default-format variants and the Default formats themselves.
-- Safe because 0022 changed no costing behaviour and wrote nothing else.
--
-- IT DOES DELETE DATA. If an owner has since priced or sold against a
-- backfilled variant, those references are removed too (recipe_prices,
-- cost_snapshots, order_lines and sales_entries hold variant_id as ON DELETE
-- SET NULL, so the rows survive with a null variant). Check before running.
-- ============================================================================

do $$
begin
  if to_regclass('public.recipe_variants') is null then
    raise exception '0022 rollback FAILED: 0021 is not applied.';
  end if;
  raise notice '0022 rollback: removing % variant(s) and % Default format(s).',
    (select count(*) from recipe_variants v join serving_formats f
       on f.id=v.format_id and lower(f.name)='default'),
    (select count(*) from serving_formats where lower(name)='default');
end
$$;

delete from recipe_variants v
 using serving_formats f
 where f.id = v.format_id and lower(f.name) = 'default';

delete from serving_formats where lower(name) = 'default';

do $$
begin
  if exists (select 1 from serving_formats where lower(name)='default') then
    raise exception '0022 rollback self-check FAILED: Default format(s) remain.';
  end if;
  raise notice '0022 ROLLBACK OK: backfill removed; every other format and '
               'variant left untouched.';
end
$$;
