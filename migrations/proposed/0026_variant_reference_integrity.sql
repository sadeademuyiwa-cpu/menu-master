-- ============================================================================
-- MENU MASTER NG
-- 0026: composite foreign keys on variant_id -- SECURITY FIX
--
-- FOUND BY: tests/016_gate2_attack_matrix.sql, attack 8.
-- Requires: 0021-0025 applied (53 fn_* / 49 relations / 105 policies).
--
-- THE DEFECT
--   0021 added variant_id to cost_snapshots, recipe_prices, order_lines and
--   sales_entries as a PLAIN single-column foreign key:
--       variant_id uuid references recipe_variants(id)
--
--   Every other cross-table reference in this database uses the Gate 1
--   composite pattern -- 76 of them do -- precisely so that pointing at
--   another account's row is a FOREIGN KEY VIOLATION rather than a policy
--   decision. These four columns were the exception, and I introduced them.
--
--   PROVEN EXPLOIT: account B inserted
--       recipe_prices(account_id = B, recipe_id = B's recipe, variant_id = A's variant)
--   RLS passed because B set account_id to its own. The plain FK passed
--   because A's variant does exist. B thereby held a durable reference to a
--   row in another tenant.
--
--   No data of A's leaked through it: v_price_check joins prices by recipe_id,
--   so the row only ever surfaces on B's own rows. The exposure is a
--   cross-tenant REFERENCE, not a read. It is still exactly the class of thing
--   the composite-FK architecture exists to make impossible, and audit item 33
--   ("cross-account references impossible") is currently false.
--
-- THE FIX
--   Replace each plain FK with the composite form, matching the 0004 pattern:
--       foreign key (variant_id, account_id)
--         references recipe_variants(id, account_id)
--         on delete set null (variant_id)
--
--   The column list on SET NULL matters: account_id is NOT NULL on all four
--   tables, so an unqualified SET NULL would try to null it and fail. PG 15+
--   allows naming the column, and production is 17.6.
--
-- ADDITIVE AND REVERSIBLE. No column is added or dropped, no data is touched,
-- no policy changes. Only the strength of four constraints changes.
-- ============================================================================

do $$
declare v_bad int;
begin
  if (select count(*) from pg_proc
       where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 53 then
    raise exception '0026 preflight FAILED: expected 53 fn_* functions, found %. '
                    'Are 0021-0025 all applied?',
      (select count(*) from pg_proc
        where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;

  if not exists (select 1 from pg_constraint
                  where conname='ux_recipe_variants_id_account') then
    raise exception '0026 preflight FAILED: ux_recipe_variants_id_account is '
                    'missing; the composite FK has no target.';
  end if;

  -- refuse to run while an offending row already exists: the constraint would
  -- fail anyway, and a silent failure here would be worse than a loud one
  select
    (select count(*) from recipe_prices  p join recipe_variants v on v.id=p.variant_id
      where p.account_id <> v.account_id)
  + (select count(*) from order_lines    o join recipe_variants v on v.id=o.variant_id
      where o.account_id <> v.account_id)
  + (select count(*) from sales_entries  s join recipe_variants v on v.id=s.variant_id
      where s.account_id <> v.account_id)
  + (select count(*) from cost_snapshots c join recipe_variants v on v.id=c.variant_id
      where c.account_id <> v.account_id)
  into v_bad;

  if v_bad > 0 then
    raise exception '0026 preflight FAILED: % existing row(s) already point at '
                    'another account''s variant. These must be investigated and '
                    'cleared before the constraint can be applied -- do not '
                    'delete them without reading them first.', v_bad;
  end if;

  raise notice '0026 preflight OK. No cross-account variant reference exists yet.';
end
$$;

alter table recipe_prices
  drop constraint recipe_prices_variant_id_fkey,
  add  constraint fk_recipe_prices_variant
       foreign key (variant_id, account_id)
       references recipe_variants(id, account_id)
       on delete set null (variant_id);

alter table order_lines
  drop constraint order_lines_variant_id_fkey,
  add  constraint fk_order_lines_variant
       foreign key (variant_id, account_id)
       references recipe_variants(id, account_id)
       on delete set null (variant_id);

alter table sales_entries
  drop constraint sales_entries_variant_id_fkey,
  add  constraint fk_sales_entries_variant
       foreign key (variant_id, account_id)
       references recipe_variants(id, account_id)
       on delete set null (variant_id);

alter table cost_snapshots
  drop constraint cost_snapshots_variant_id_fkey,
  add  constraint fk_cost_snapshots_variant
       foreign key (variant_id, account_id)
       references recipe_variants(id, account_id)
       on delete set null (variant_id);

-- ----------------------------------------------------------------------------
-- SELF-CHECK
-- ----------------------------------------------------------------------------
do $$
declare v_composite int; v_plain int; v_fns int; v_rels int; v_pols int;
begin
  select count(*) into v_composite from pg_constraint
   where conname in ('fk_recipe_prices_variant','fk_order_lines_variant',
                     'fk_sales_entries_variant','fk_cost_snapshots_variant')
     and pg_get_constraintdef(oid) like '%(id, account_id)%';
  if v_composite <> 4 then
    raise exception '0026 self-check FAILED: % of 4 composite variant FKs present.',
      v_composite;
  end if;

  select count(*) into v_plain from pg_constraint
   where contype='f'
     and pg_get_constraintdef(oid) like 'FOREIGN KEY (variant_id) REFERENCES%';
  if v_plain <> 0 then
    raise exception '0026 self-check FAILED: % plain single-column variant FK(s) '
                    'survive. Every one must be composite.', v_plain;
  end if;

  select count(*) into v_fns from pg_proc
   where pronamespace='public'::regnamespace and proname like 'fn\_%';
  select count(*) into v_rels from pg_class
   where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f');
  select count(*) into v_pols from pg_policies where schemaname='public';
  if v_fns <> 53 or v_rels <> 49 or v_pols <> 105 then
    raise exception '0026 self-check FAILED: % / % / %, expected 53 / 49 / 105. '
                    'This migration changes constraints only.', v_fns, v_rels, v_pols;
  end if;

  raise notice '0026 OK: all four variant references are composite and '
               'account-scoped; cross-tenant attachment is now a foreign key '
               'violation, not a policy decision.';
end
$$;
