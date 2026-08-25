-- ============================================================================
-- MENU MASTER NG
-- 0021: serving formats and recipe variants -- GATE 2, PHASE 1 (STRUCTURAL)
--
-- Authority: docs/GATE2_FINAL_DESIGN.md. Nothing here goes beyond it.
-- Preflight: deploy/runbook/G2_PREFLIGHT.sql, 28 GO / 3 INFORMATIONAL / 0 STOP
--            against production on the 40 fn_* / 44 relations / 93 policies
--            baseline.
--
-- WHAT THIS MIGRATION DOES
--   Adds the four Gate 2 tables, one enum, ten nullable columns, one
--   constraint on an existing table, seven trigger functions and twelve
--   policies. That is all.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   No costing formula moves. No view is repointed. fn_freeze_sale_cost is
--   untouched. recipes.portion_qty and business_settings.expected_monthly_units
--   are RETAINED and deprecated, never dropped. No backfill -- that is 0022.
--   Existing costing behaviour is preserved bit for bit (design section 9).
--
-- TWO APPROVED COMPATIBILITY CHANGES (preflight F1 and F2)
--   F1  fn_assert_unit_visible (0004) hardcodes new.unit_id and cannot serve
--       capacity_unit_id / sellable_unit_id / overhead_basis_unit_id. This
--       migration adds a SIBLING, fn_assert_unit_visible_col, reading the
--       column name from TG_ARGV[0]. The 0004 function is NOT modified and its
--       three existing triggers keep their behaviour exactly.
--   F2  recipes has no unique (id, business_id), so the composite FK the design
--       requires on recipe_variants cannot be created. This migration adds
--       ux_recipes_id_business. Additive, and always satisfiable because id is
--       already the primary key.
--
-- ADDITIVE. No earlier migration is rewritten. 0001-0016 are not modified.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. PREFLIGHT -- refuse to run against anything but the verified baseline
-- ----------------------------------------------------------------------------
do $$
begin
  if (select count(*) from pg_proc
       where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 40 then
    raise exception '0021 preflight FAILED: expected 40 fn_* functions, found %.',
      (select count(*) from pg_proc
        where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;

  if (select count(*) from pg_class
       where relnamespace='public'::regnamespace
         and relkind in ('r','p','v','m','f')) <> 44 then
    raise exception '0021 preflight FAILED: expected 44 relations, found %.',
      (select count(*) from pg_class
        where relnamespace='public'::regnamespace
          and relkind in ('r','p','v','m','f'));
  end if;

  if (select count(*) from pg_policies where schemaname='public') <> 93 then
    raise exception '0021 preflight FAILED: expected 93 policies, found %.',
      (select count(*) from pg_policies where schemaname='public');
  end if;

  if exists (select 1 from pg_class
              where relnamespace='public'::regnamespace
                and relname in ('serving_formats','recipe_variants',
                                'serving_format_packaging','serving_format_changes')) then
    raise exception '0021 preflight FAILED: a Gate 2 table already exists.';
  end if;

  if exists (select 1 from pg_type where typname='variant_costing_basis') then
    raise exception '0021 preflight FAILED: variant_costing_basis already exists.';
  end if;

  if not exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
                  where t.typname='unit_kind' and e.enumlabel='container') then
    raise exception '0021 preflight FAILED: unit_kind lacks container (0002 missing).';
  end if;

  raise notice '0021 preflight OK on the 40/44/93 baseline.';
end
$$;

-- ----------------------------------------------------------------------------
-- 1. F2 -- the composite FK target recipe_variants requires
-- ----------------------------------------------------------------------------
alter table recipes
  add constraint ux_recipes_id_business unique (id, business_id);

-- ----------------------------------------------------------------------------
-- 2. THE COSTING BASIS (D3)
--
-- Capacity and sellable quantity are separate concepts. A variant declares
-- which one governs it, and the check constraints below make holding both
-- impossible rather than merely discouraged.
-- ----------------------------------------------------------------------------
create type variant_costing_basis as enum ('capacity', 'explicit_qty');

-- ----------------------------------------------------------------------------
-- 3. SERVING FORMATS -- the physical container, business owned
--
-- capacity_qty is NULL until the owner measures it. NULL is a valid, honest
-- state: no container size is ever inferred (locked rule 1).
-- ----------------------------------------------------------------------------
create table serving_formats (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  business_id       uuid not null,
  name              text not null,
  description       text,
  capacity_qty      numeric(14,3),
  capacity_unit_id  uuid references units(id),
  is_active         boolean not null default true,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint ux_serving_formats_id_account  unique (id, account_id),
  constraint ux_serving_formats_id_business unique (id, business_id),
  constraint fk_serving_formats_business
    foreign key (business_id, account_id)
    references businesses(id, account_id) on delete cascade,

  -- never a bare number, never a bare unit
  constraint chk_capacity_pair
    check ((capacity_qty is null) = (capacity_unit_id is null)),
  constraint chk_capacity_positive
    check (capacity_qty is null or capacity_qty > 0)
);

create unique index ux_serving_formats_business_name
  on serving_formats (business_id, lower(name));
create index ix_serving_formats_business on serving_formats (business_id);

-- ----------------------------------------------------------------------------
-- 4. RECIPE VARIANTS -- the recipe x format intersection
--
-- D5 is structural, not a convention: there is no variant line table, so a
-- variant cannot carry an ingredient and therefore cannot alter a formula.
-- ----------------------------------------------------------------------------
create table recipe_variants (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  business_id       uuid not null,
  recipe_id         uuid not null,
  format_id         uuid not null,
  costing_basis     variant_costing_basis not null,
  sellable_qty      numeric(14,3),
  sellable_unit_id  uuid references units(id),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint ux_recipe_variants_id_account   unique (id, account_id),
  constraint ux_recipe_variants_id_business  unique (id, business_id),
  constraint ux_recipe_variants_recipe_format unique (recipe_id, format_id),

  constraint fk_recipe_variants_business
    foreign key (business_id, account_id)
    references businesses(id, account_id) on delete cascade,
  -- same-business enforcement, by foreign key rather than by policy
  constraint fk_recipe_variants_recipe
    foreign key (recipe_id, business_id)
    references recipes(id, business_id) on delete cascade,
  constraint fk_recipe_variants_format
    foreign key (format_id, business_id)
    references serving_formats(id, business_id) on delete cascade,

  constraint chk_basis_explicit check (
    costing_basis <> 'explicit_qty'
    or (sellable_qty is not null and sellable_unit_id is not null)),
  constraint chk_basis_capacity check (
    costing_basis <> 'capacity'
    or (sellable_qty is null and sellable_unit_id is null)),
  constraint chk_sellable_positive check (
    sellable_qty is null or sellable_qty > 0)
);

create index ix_recipe_variants_recipe on recipe_variants (recipe_id);
create index ix_recipe_variants_format on recipe_variants (format_id);

-- ----------------------------------------------------------------------------
-- 5. FORMAT PACKAGING (D4) -- consumed once per sold unit
--
-- One to many from day one, so lids, spoons, labels and carrier bags need no
-- redesign. Packaging items remain ingredients with kind='packaging', keeping
-- price history, purchase posting and the completeness gate.
-- ----------------------------------------------------------------------------
create table serving_format_packaging (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references accounts(id) on delete cascade,
  business_id        uuid not null,
  format_id          uuid not null,
  packaging_item_id  uuid not null,
  qty                numeric(14,3) not null check (qty > 0),
  is_cost_bearing    boolean not null default true,
  exclusion_reason   exclusion_reason,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint ux_sfp_id_account unique (id, account_id),
  constraint ux_sfp_format_item unique (format_id, packaging_item_id),

  constraint fk_sfp_business
    foreign key (business_id, account_id)
    references businesses(id, account_id) on delete cascade,
  constraint fk_sfp_format
    foreign key (format_id, business_id)
    references serving_formats(id, business_id) on delete cascade,
  constraint fk_sfp_item
    foreign key (packaging_item_id, account_id)
    references ingredients(id, account_id) on delete restrict,

  -- mirrors recipe_lines: exemption is deliberate and must be named
  constraint chk_sfp_reason
    check (is_cost_bearing or exclusion_reason is not null)
);

create index ix_sfp_format on serving_format_packaging (format_id);

-- ----------------------------------------------------------------------------
-- 6. FORMAT CHANGE LOG (D6) -- append only
--
-- A format is historically traceable. Written by trigger; UPDATE and DELETE
-- are blocked by the same guard pattern cost_snapshots uses.
-- ----------------------------------------------------------------------------
create table serving_format_changes (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references accounts(id) on delete cascade,
  business_id  uuid not null,
  format_id    uuid not null,
  changed_at   timestamptz not null default now(),
  changed_by   uuid references auth.users(id) on delete set null,
  field        text not null,
  old_value    text,
  new_value    text,

  constraint fk_sfc_business
    foreign key (business_id, account_id)
    references businesses(id, account_id) on delete cascade,
  constraint fk_sfc_format
    foreign key (format_id, business_id)
    references serving_formats(id, business_id) on delete cascade
);

create index ix_sfc_format on serving_format_changes (format_id, changed_at desc);

-- ----------------------------------------------------------------------------
-- 7. ADDITIVE COLUMNS ON EXISTING TABLES
--
-- Every column nullable. Nothing dropped. Pre-migration rows stay valid and
-- every existing read path continues to see exactly what it saw before.
-- ----------------------------------------------------------------------------
alter table business_settings
  add column overhead_basis_qty      numeric(14,3),
  add column overhead_basis_unit_id  uuid references units(id);

alter table cost_snapshots
  add column variant_id              uuid references recipe_variants(id) on delete set null,
  add column resolved_qty            numeric(18,6),
  add column resolved_unit_id        uuid references units(id),
  add column basis_used              variant_costing_basis,
  add column format_packaging_cost   numeric(18,4);

alter table recipe_prices
  add column variant_id uuid references recipe_variants(id) on delete set null;

alter table order_lines
  add column variant_id uuid references recipe_variants(id) on delete set null;

alter table sales_entries
  add column variant_id uuid references recipe_variants(id) on delete set null;

-- DEFERRED TO PHASE 5 (0025): chk_complete_requires_resolution
--
--   Design section 3 places `is_complete implies resolved_qty is not null` on
--   cost_snapshots. It CANNOT be added in Phase 1, and the replica proved why:
--   fn_compute_recipe_cost_snapshot (0012) writes complete snapshots without
--   resolved_qty, because resolved_qty is a Gate 2 column that only Phase 5
--   teaches the engine to populate. Adding the constraint now makes every
--   completely-costed recipe fail to snapshot -- suite 001 dies at line 173.
--
--   Preflight row 31 counted EXISTING complete snapshots (zero in production)
--   and so did not catch this: the breakage is in FUTURE writes, not stored
--   rows. Phase 1 must be zero behavioural change, and this constraint is not.
--
--   It belongs in 0025, added in the same migration that repoints the engine.

-- NOTE ON chk_variant_matches_recipe
--   Design section 3 asks for a constraint asserting that a sale's variant
--   belongs to the recipe the sale names. PostgreSQL CHECK constraints cannot
--   reference another table, so this rule CANNOT be a check constraint. It is
--   enforced by fn_assert_sale_variant_valid below, on both INSERT and UPDATE,
--   which is strictly stronger than a check constraint would have been.

-- ----------------------------------------------------------------------------
-- 8. TRIGGER FUNCTIONS
--
-- All seven are plain (not SECURITY DEFINER), matching the 0004 pattern, and
-- all have EXECUTE revoked from public, anon and authenticated per 0016/0018.
-- ----------------------------------------------------------------------------

-- F1. The 0004 sibling. Reads the unit column name from TG_ARGV[0] so one
--     function serves capacity_unit_id, sellable_unit_id and
--     overhead_basis_unit_id. fn_assert_unit_visible is NOT modified.
create or replace function fn_assert_unit_visible_col()
returns trigger language plpgsql as $$
declare
  v_col          text := tg_argv[0];
  v_unit         uuid;
  v_unit_account uuid;
begin
  execute format('select ($1).%I', v_col) into v_unit using new;
  if v_unit is null then
    return new;
  end if;
  select account_id into v_unit_account from units where id = v_unit;
  if v_unit_account is not null and v_unit_account <> new.account_id then
    raise exception 'Unit % belongs to another account', v_unit
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- A format packaging line must point at an item the owner classified as
-- packaging. Enforced here because a foreign key cannot see kind.
create or replace function fn_assert_packaging_item_kind()
returns trigger language plpgsql as $$
declare v_kind item_kind;
begin
  select kind into v_kind from ingredients where id = new.packaging_item_id;
  if v_kind is distinct from 'packaging'::item_kind then
    raise exception 'Item % is not packaging (kind=%)', new.packaging_item_id, v_kind
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- D6. Every field that changes the meaning of a format is logged, one row per
--     field, so "Family Bowl 4 L became 4.5 L on this date" is answerable.
create or replace function fn_log_serving_format_change()
returns trigger language plpgsql as $$
begin
  if new.name is distinct from old.name then
    insert into serving_format_changes
      (account_id, business_id, format_id, changed_by, field, old_value, new_value)
    values (old.account_id, old.business_id, old.id, auth.uid(),
            'name', old.name, new.name);
  end if;

  if new.capacity_qty is distinct from old.capacity_qty then
    insert into serving_format_changes
      (account_id, business_id, format_id, changed_by, field, old_value, new_value)
    values (old.account_id, old.business_id, old.id, auth.uid(),
            'capacity_qty', old.capacity_qty::text, new.capacity_qty::text);
  end if;

  if new.capacity_unit_id is distinct from old.capacity_unit_id then
    insert into serving_format_changes
      (account_id, business_id, format_id, changed_by, field, old_value, new_value)
    values (old.account_id, old.business_id, old.id, auth.uid(),
            'capacity_unit_id', old.capacity_unit_id::text, new.capacity_unit_id::text);
  end if;

  if new.is_active is distinct from old.is_active then
    insert into serving_format_changes
      (account_id, business_id, format_id, changed_by, field, old_value, new_value)
    values (old.account_id, old.business_id, old.id, auth.uid(),
            'is_active', old.is_active::text, new.is_active::text);
  end if;

  return new;
end;
$$;

-- The change log is history. History is not edited.
create or replace function fn_block_format_change_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'serving_format_changes is append only.';
end;
$$;

-- D7. A retired format accepts no new variants. Existing ones are preserved.
create or replace function fn_reject_variant_on_inactive_format()
returns trigger language plpgsql as $$
begin
  if not (select is_active from serving_formats where id = new.format_id) then
    raise exception 'Serving format % is inactive; no new variant may be created',
      new.format_id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- D7 plus the variant/recipe match. One lookup serves both, on the same two
-- tables and the same write paths.
--   * The variant must belong to the recipe the sale names -- INSERT and UPDATE.
--   * A retired format takes no NEW sales -- INSERT only, so historical rows
--     against a since-deactivated format stay editable (D7 preserves history).
create or replace function fn_assert_sale_variant_valid()
returns trigger language plpgsql as $$
declare v_recipe uuid; v_active boolean;
begin
  if new.variant_id is null then
    return new;
  end if;

  select v.recipe_id, f.is_active into v_recipe, v_active
    from recipe_variants v
    join serving_formats f on f.id = v.format_id
   where v.id = new.variant_id;

  if v_recipe is null then
    raise exception 'Variant % does not exist', new.variant_id
      using errcode = 'check_violation';
  end if;

  if new.recipe_id is distinct from v_recipe then
    raise exception 'Variant % belongs to recipe %, but this line names recipe %',
      new.variant_id, v_recipe, new.recipe_id
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' and v_active is not true then
    raise exception 'Variant % belongs to an inactive serving format', new.variant_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- D4. A packaging item may be costed at recipe level OR at format level for a
--     given variant, never both. The conflict only becomes real when a variant
--     joins a recipe to a format, so all three insert paths are checked.
create or replace function fn_assert_no_packaging_double_count()
returns trigger language plpgsql as $$
declare v_clash uuid;
begin
  if tg_table_name = 'recipe_variants' then
    select l.ingredient_id into v_clash
      from recipe_lines l
      join ingredients i on i.id = l.ingredient_id and i.kind = 'packaging'
     where l.recipe_id = new.recipe_id
       and exists (select 1 from serving_format_packaging p
                    where p.format_id = new.format_id
                      and p.packaging_item_id = l.ingredient_id)
     limit 1;

  elsif tg_table_name = 'serving_format_packaging' then
    select new.packaging_item_id into v_clash
     where exists (
       select 1 from recipe_variants v
         join recipe_lines l on l.recipe_id = v.recipe_id
        where v.format_id = new.format_id
          and l.ingredient_id = new.packaging_item_id);

  elsif tg_table_name = 'recipe_lines' then
    if new.ingredient_id is null
       or not exists (select 1 from ingredients
                       where id = new.ingredient_id and kind = 'packaging') then
      return new;
    end if;
    select new.ingredient_id into v_clash
     where exists (
       select 1 from recipe_variants v
         join serving_format_packaging p on p.format_id = v.format_id
        where v.recipe_id = new.recipe_id
          and p.packaging_item_id = new.ingredient_id);
  end if;

  if v_clash is not null then
    raise exception 'Packaging item % is already costed at the other level for '
                    'this recipe/format pair. Choose recipe level or format '
                    'level, not both.', v_clash
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function fn_assert_unit_visible_col()          from public, anon, authenticated;
revoke execute on function fn_assert_packaging_item_kind()       from public, anon, authenticated;
revoke execute on function fn_log_serving_format_change()        from public, anon, authenticated;
revoke execute on function fn_block_format_change_mutation()     from public, anon, authenticated;
revoke execute on function fn_reject_variant_on_inactive_format() from public, anon, authenticated;
revoke execute on function fn_assert_sale_variant_valid()        from public, anon, authenticated;
revoke execute on function fn_assert_no_packaging_double_count() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 9. TRIGGERS
-- ----------------------------------------------------------------------------
create trigger trg_serving_formats_unit_scope
  before insert or update on serving_formats
  for each row execute function fn_assert_unit_visible_col('capacity_unit_id');

create trigger trg_recipe_variants_unit_scope
  before insert or update on recipe_variants
  for each row execute function fn_assert_unit_visible_col('sellable_unit_id');

create trigger trg_business_settings_overhead_unit_scope
  before insert or update on business_settings
  for each row execute function fn_assert_unit_visible_col('overhead_basis_unit_id');

create trigger trg_sfp_item_kind
  before insert or update on serving_format_packaging
  for each row execute function fn_assert_packaging_item_kind();

create trigger trg_serving_formats_log_change
  after update on serving_formats
  for each row execute function fn_log_serving_format_change();

create trigger trg_sfc_append_only
  before update or delete on serving_format_changes
  for each row execute function fn_block_format_change_mutation();

create trigger trg_recipe_variants_format_active
  before insert on recipe_variants
  for each row execute function fn_reject_variant_on_inactive_format();

create trigger trg_order_lines_variant_valid
  before insert or update on order_lines
  for each row execute function fn_assert_sale_variant_valid();

create trigger trg_sales_entries_variant_valid
  before insert or update on sales_entries
  for each row execute function fn_assert_sale_variant_valid();

create trigger trg_recipe_variants_no_double_count
  before insert on recipe_variants
  for each row execute function fn_assert_no_packaging_double_count();

create trigger trg_sfp_no_double_count
  before insert on serving_format_packaging
  for each row execute function fn_assert_no_packaging_double_count();

create trigger trg_recipe_lines_no_double_count
  before insert on recipe_lines
  for each row execute function fn_assert_no_packaging_double_count();

-- ----------------------------------------------------------------------------
-- 10. RLS AND POLICIES (design section 8)
--
-- TWELVE policies, not fourteen. serving_formats and recipe_variants get NO
-- DELETE policy: D7 is "deactivate, never delete", and a DELETE path would
-- contradict it. serving_format_changes gets SELECT and INSERT only, because
-- it is append-only history.
--
-- serving_format_packaging SELECT is cost-role gated: a competitor's container
-- list plus prices is commercial intelligence, and packaging cost is an
-- inference channel into supplier pricing.
-- ----------------------------------------------------------------------------
alter table serving_formats          enable row level security;
alter table recipe_variants          enable row level security;
alter table serving_format_packaging enable row level security;
alter table serving_format_changes   enable row level security;

-- serving_formats: 3
create policy p_serving_formats_select on serving_formats for select
  using (fn_is_account_member(account_id));
create policy p_serving_formats_insert on serving_formats for insert
  with check (fn_is_account_member(account_id)
              and fn_has_account_role(account_id,
                    array['owner','manager']::member_role[]));
create policy p_serving_formats_update on serving_formats for update
  using      (fn_is_account_member(account_id)
              and fn_has_account_role(account_id,
                    array['owner','manager']::member_role[]))
  with check (fn_is_account_member(account_id)
              and fn_has_account_role(account_id,
                    array['owner','manager']::member_role[]));

-- recipe_variants: 3
create policy p_recipe_variants_select on recipe_variants for select
  using (fn_is_account_member(account_id));
create policy p_recipe_variants_insert on recipe_variants for insert
  with check (fn_is_account_member(account_id)
              and fn_has_account_role(account_id,
                    array['owner','manager','kitchen']::member_role[]));
create policy p_recipe_variants_update on recipe_variants for update
  using      (fn_is_account_member(account_id)
              and fn_has_account_role(account_id,
                    array['owner','manager','kitchen']::member_role[]))
  with check (fn_is_account_member(account_id)
              and fn_has_account_role(account_id,
                    array['owner','manager','kitchen']::member_role[]));

-- serving_format_packaging: 4, SELECT cost-gated
create policy p_sfp_select on serving_format_packaging for select
  using (fn_is_account_member(account_id) and fn_can_see_costs(account_id));
create policy p_sfp_insert on serving_format_packaging for insert
  with check (fn_is_account_member(account_id)
              and fn_has_account_role(account_id,
                    array['owner','manager']::member_role[]));
create policy p_sfp_update on serving_format_packaging for update
  using      (fn_is_account_member(account_id)
              and fn_has_account_role(account_id,
                    array['owner','manager']::member_role[]))
  with check (fn_is_account_member(account_id)
              and fn_has_account_role(account_id,
                    array['owner','manager']::member_role[]));
create policy p_sfp_delete on serving_format_packaging for delete
  using (fn_is_account_member(account_id)
         and fn_has_account_role(account_id,
               array['owner','manager']::member_role[]));

-- serving_format_changes: 2, append-only
create policy p_sfc_select on serving_format_changes for select
  using (fn_is_account_member(account_id));
create policy p_sfc_insert on serving_format_changes for insert
  with check (fn_is_account_member(account_id));

-- ----------------------------------------------------------------------------
-- 11. GRANTS
--
-- 0018 revoked the default privileges for anon and authenticated, so these
-- tables arrive with no grants at all. anon receives NOTHING: the 0018
-- invariant is SELECT on exactly five reference tables and EXECUTE on zero
-- fn_* functions, and 0021 must leave it untouched.
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on serving_formats          to authenticated;
grant select, insert, update, delete on recipe_variants          to authenticated;
grant select, insert, update, delete on serving_format_packaging to authenticated;
grant select, insert                 on serving_format_changes   to authenticated;

grant all on serving_formats          to service_role;
grant all on recipe_variants          to service_role;
grant all on serving_format_packaging to service_role;
grant all on serving_format_changes   to service_role;

-- ----------------------------------------------------------------------------
-- 12. SELF-CHECK -- the migration proves its own arithmetic before committing
-- ----------------------------------------------------------------------------
do $$
declare v_fns int; v_rels int; v_pols int; v_anon_tables int; v_anon_fns int;
begin
  select count(*) into v_fns from pg_proc
    where pronamespace='public'::regnamespace and proname like 'fn\_%';
  select count(*) into v_rels from pg_class
    where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f');
  select count(*) into v_pols from pg_policies where schemaname='public';

  if v_fns <> 47 then
    raise exception '0021 self-check FAILED: fn_* is %, expected 47.', v_fns;
  end if;
  if v_rels <> 48 then
    raise exception '0021 self-check FAILED: relations is %, expected 48.', v_rels;
  end if;
  if v_pols <> 105 then
    raise exception '0021 self-check FAILED: policies is %, expected 105.', v_pols;
  end if;

  select count(distinct table_name) into v_anon_tables
    from information_schema.role_table_grants
   where grantee='anon' and table_schema='public';
  if v_anon_tables <> 5 then
    raise exception '0021 self-check FAILED: anon can read % table(s), expected 5. '
                    'The 0018 surface must not change.', v_anon_tables;
  end if;

  select count(*) into v_anon_fns from pg_proc p
   where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_anon_fns <> 0 then
    raise exception '0021 self-check FAILED: anon holds EXECUTE on % fn_* function(s).',
                    v_anon_fns;
  end if;

  if not exists (select 1 from pg_constraint where conname='ux_recipes_id_business') then
    raise exception '0021 self-check FAILED: ux_recipes_id_business (F2) is missing.';
  end if;

  if not exists (select 1 from pg_proc
                  where pronamespace='public'::regnamespace
                    and proname='fn_assert_unit_visible'
                    and prosrc like '%new.unit_id%') then
    raise exception '0021 self-check FAILED: the 0004 fn_assert_unit_visible was '
                    'altered. It must be left exactly as Gate 1 wrote it.';
  end if;

  raise notice '0021 OK: 47 fn_* / 48 relations / 105 policies; anon surface unchanged '
               '(5 tables, 0 functions); F1 sibling added, 0004 function intact; '
               'F2 constraint present.';
end
$$;
