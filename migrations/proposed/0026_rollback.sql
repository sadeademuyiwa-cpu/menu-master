-- ============================================================================
-- 0026 ROLLBACK -- restores the plain single-column variant foreign keys
--
-- WARNING: this REOPENS the cross-tenant reference hole that 0026 closed.
-- It exists for completeness of the migration discipline, not because rolling
-- back is ever the right answer to a security fix. If 0026 is causing a
-- problem, fix the cause; do not restore the weaker constraint.
-- ============================================================================

do $$
begin
  if (select count(*) from pg_constraint
       where conname in ('fk_recipe_prices_variant','fk_order_lines_variant',
                         'fk_sales_entries_variant','fk_cost_snapshots_variant')) <> 4 then
    raise exception '0026 rollback FAILED: the four composite FKs are not all present.';
  end if;
  raise warning '0026 rollback: restoring the PLAIN variant foreign keys. This '
                'reopens the cross-tenant reference proven by attack 8.';
end
$$;

alter table recipe_prices
  drop constraint fk_recipe_prices_variant,
  add  constraint recipe_prices_variant_id_fkey
       foreign key (variant_id) references recipe_variants(id) on delete set null;

alter table order_lines
  drop constraint fk_order_lines_variant,
  add  constraint order_lines_variant_id_fkey
       foreign key (variant_id) references recipe_variants(id) on delete set null;

alter table sales_entries
  drop constraint fk_sales_entries_variant,
  add  constraint sales_entries_variant_id_fkey
       foreign key (variant_id) references recipe_variants(id) on delete set null;

alter table cost_snapshots
  drop constraint fk_cost_snapshots_variant,
  add  constraint cost_snapshots_variant_id_fkey
       foreign key (variant_id) references recipe_variants(id) on delete set null;

do $$
begin
  if (select count(*) from pg_constraint where contype='f'
       and pg_get_constraintdef(oid) like 'FOREIGN KEY (variant_id) REFERENCES%') <> 4 then
    raise exception '0026 rollback self-check FAILED: the four plain FKs were not restored.';
  end if;
  raise notice '0026 ROLLBACK OK: plain variant foreign keys restored. The '
               'cross-tenant reference hole is OPEN again.';
end
$$;
