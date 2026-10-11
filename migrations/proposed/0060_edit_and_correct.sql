-- ============================================================================
-- MENU MASTER NG
-- 0060: fixing a mistake without starting over
--
-- Requires: 0001-0059 applied.
--
-- WHY
--   An owner who typed the wrong amount on a purchase had to cancel it and
--   re-enter every line. A cancelled sale came back as an EMPTY replacement to
--   retype. A changed wage or monthly bill left every dish costed at the old
--   figure until something else happened to recompute it. A customer could be
--   created but never put away. And an ingredient's measure could be changed
--   under purchases already recorded in it, which silently re-based their
--   quantities.
--
--   The rule this migration serves, from docs/PLAN_NATURAL_UX.md §3:
--     drafts edit freely; current facts edit in place; posted records are
--     never edited but can be CORRECTED in one step; nothing with history is
--     hard-deleted.
--
-- HOW
--   purchases.replaced_by          which corrected purchase replaced this one.
--   customers.deleted_at           a customer put away, never deleted: their
--                                  sales keep pointing at them.
--   fn_correct_purchase(...)       one transaction: the corrected purchase is
--                                  recorded and posted, then the original is
--                                  reversed by fn_reverse_purchase exactly as
--                                  before, and linked. Nothing is written if a
--                                  line cannot be costed; the blockers are
--                                  returned instead, as fn_post_purchase does.
--   fn_reissue_order(uuid)         REPLACED. The replacement now carries the
--                                  original's lines, discount and date, so the
--                                  owner changes the one wrong thing. A second
--                                  live replacement of the same sale is refused.
--   fn_recompute_business_recipes  one snapshot per dish (and per active size)
--                                  of a business, for after a wage or bill
--                                  changes. Nothing in the schema recomputes
--                                  on those tables; the app calls this once.
--   fn_trg_ingredient_base_unit_locked
--                                  BEFORE UPDATE on ingredients: the base unit
--                                  may not change once a purchase or a recipe
--                                  line is measured in it.
--
-- WHAT DOES NOT CHANGE
--   No policy (118 before and after): every edit the app gains is already
--   permitted by the 0015/0028 row policies; what was missing was a screen.
--   fn_reverse_purchase, fn_post_purchase and fn_void_order are untouched.
--   Snapshots stay append-only; posted purchases and confirmed sales stay
--   immutable (0006 and 0044/0045 guards unchanged).
-- ============================================================================

drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0060 ABORT: this executor is not honouring transaction control '
      '(each statement is committing on its own). Run it with '
      'psql --single-transaction over the Session Pooler.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'site') then
    raise exception '0060 preflight FAILED: the site bucket is missing. Apply 0059 first.';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='purchases' and column_name='replaced_by') then
    raise exception '0060 preflight FAILED: purchases.replaced_by already exists.';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='customers' and column_name='deleted_at') then
    raise exception '0060 preflight FAILED: customers.deleted_at already exists.';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 118 then
    raise exception '0060 preflight FAILED: policy count is %, expected 118.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 95 then
    raise exception '0060 preflight FAILED: fn_* count is %, expected 95.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Two columns
-- ---------------------------------------------------------------------------
alter table purchases add column replaced_by uuid references purchases(id) on delete set null;
create index ix_fk_purchases_replaced_by on purchases (replaced_by);

alter table customers add column deleted_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. The base unit is locked once something is measured in it
-- ---------------------------------------------------------------------------
create or replace function fn_trg_ingredient_base_unit_locked()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if new.base_unit_id is distinct from old.base_unit_id then
    if exists (select 1 from ingredient_prices where ingredient_id = old.id)
       or exists (select 1 from purchase_lines where ingredient_id = old.id)
       or exists (select 1 from recipe_lines where ingredient_id = old.id) then
      raise exception 'The measure of % cannot change: purchases or recipes are already recorded in it.', old.name
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$fn$;

-- A trigger runs as the table's owner; no client role needs to call this.
revoke all on function fn_trg_ingredient_base_unit_locked() from public, anon, authenticated;

create trigger trg_ingredients_base_unit_locked
  before update on ingredients
  for each row execute function fn_trg_ingredient_base_unit_locked();

-- ---------------------------------------------------------------------------
-- 3. Correcting a posted purchase in one step
-- ---------------------------------------------------------------------------
-- p_lines: [{ingredient_id, qty, unit_id, amount}, ...]
create or replace function fn_correct_purchase(
  p_original_id   uuid,
  p_purchase_date date,
  p_supplier_id   uuid,
  p_reference     text,
  p_note          text,
  p_lines         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_o purchases%rowtype; v_new uuid; v_posted jsonb; v_reversed jsonb;
  v_blockers jsonb := '[]'::jsonb; v_n integer := 0; r record; v_base numeric;
begin
  select * into v_o from purchases where id = p_original_id for update;
  if not found then raise exception 'Purchase % not found', p_original_id; end if;

  perform fn_require_account_role(v_o.account_id,
    array['owner','manager','accountant']::member_role[], 'correcting purchases');

  if v_o.status <> 'posted' then
    raise exception 'Only a recorded purchase can be corrected. This one is %', v_o.status
      using errcode = 'check_violation';
  end if;
  if p_purchase_date is null then
    raise exception 'A corrected purchase needs a date' using errcode = 'check_violation';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A corrected purchase needs at least one line' using errcode = 'check_violation';
  end if;
  if p_supplier_id is not null and not exists
     (select 1 from suppliers where id = p_supplier_id and account_id = v_o.account_id) then
    raise exception 'That supplier is not on this account' using errcode = 'check_violation';
  end if;

  -- Look before writing: a line that cannot be measured is reported, and
  -- nothing is recorded, exactly as fn_post_purchase answers a draft.
  for r in
    select (l->>'ingredient_id')::uuid as ingredient_id,
           (l->>'qty')::numeric        as qty,
           (l->>'unit_id')::uuid       as unit_id,
           (l->>'amount')::numeric     as amount
    from jsonb_array_elements(p_lines) l
  loop
    if r.ingredient_id is null or r.unit_id is null
       or r.qty is null or r.qty <= 0 or r.amount is null or r.amount <= 0 then
      raise exception 'Every line needs an ingredient, a unit, a quantity above zero and an amount above zero'
        using errcode = 'check_violation';
    end if;
    if not exists (select 1 from ingredients
                   where id = r.ingredient_id and account_id = v_o.account_id and deleted_at is null) then
      raise exception 'An ingredient on this correction is not on this account' using errcode = 'check_violation';
    end if;
    v_base := fn_resolve_qty_to_base(r.ingredient_id, r.qty, r.unit_id);
    if v_base is null or v_base <= 0 then
      v_blockers := v_blockers || jsonb_build_object(
        'ingredient_id', r.ingredient_id,
        'ingredient_name', (select name from ingredients where id = r.ingredient_id),
        'unit_code', (select code from units where id = r.unit_id),
        'problem', 'missing_conversion');
    end if;
  end loop;
  if jsonb_array_length(v_blockers) > 0 then
    return jsonb_build_object('corrected', false,
      'reason', 'unresolved_conversions', 'blockers', v_blockers);
  end if;

  insert into purchases (account_id, business_id, location_id, supplier_id,
                         purchase_date, reference, note, status, created_by)
  values (v_o.account_id, v_o.business_id, v_o.location_id, p_supplier_id,
          p_purchase_date, nullif(btrim(p_reference), ''), nullif(btrim(p_note), ''),
          'draft', auth.uid())
  returning id into v_new;

  insert into purchase_lines (account_id, purchase_id, ingredient_id, qty, unit_id, amount)
  select v_o.account_id, v_new,
         (l->>'ingredient_id')::uuid, (l->>'qty')::numeric, (l->>'unit_id')::uuid, (l->>'amount')::numeric
  from jsonb_array_elements(p_lines) l;
  get diagnostics v_n = row_count;

  v_posted := fn_post_purchase(v_new);
  if coalesce((v_posted->>'posted')::boolean, false) is not true then
    -- Cannot happen after the look above; if it does, nothing must remain.
    raise exception 'The corrected purchase could not be recorded: %', v_posted->>'reason'
      using errcode = 'check_violation';
  end if;

  v_reversed := fn_reverse_purchase(p_original_id,
    'Replaced by a corrected purchase recorded on ' || to_char(p_purchase_date, 'DD Mon YYYY'));

  update purchases set replaced_by = v_new where id = p_original_id;

  return jsonb_build_object('corrected', true,
    'original_purchase_id', p_original_id,
    'new_purchase_id', v_new,
    'lines', v_n,
    'reversal_purchase_id', v_reversed->>'reversal_purchase_id',
    'price_rows_written', v_posted->'price_rows_written',
    'price_rows_reversed', v_reversed->'price_rows_reversed');
end;
$fn$;

revoke all on function fn_correct_purchase(uuid, date, uuid, text, text, jsonb) from public, anon;
grant execute on function fn_correct_purchase(uuid, date, uuid, text, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. A replacement sale that carries the original's items
-- ---------------------------------------------------------------------------
-- 0014 created the replacement empty "so the corrected figures are entered
-- deliberately". In practice the owner retyped six lines to change one. The
-- lines are copied; the owner edits the wrong one and confirms. Costs are not
-- copied: they are frozen afresh at confirmation, as for any draft.
create or replace function fn_reissue_order(p_voided_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_o orders%rowtype; v_new uuid; v_no text; v_n integer := 1; v_lines integer;
begin
  select * into v_o from orders where id = p_voided_order_id for update;
  if not found then raise exception 'Order % not found', p_voided_order_id; end if;

  perform fn_require_account_role(v_o.account_id,
    array['owner','manager','sales']::member_role[], 'reissuing orders');

  if v_o.voided_at is null then
    raise exception 'Only a voided order can be reissued' using errcode='check_violation';
  end if;
  if exists (select 1 from orders where replaces = v_o.id and voided_at is null) then
    raise exception 'This sale already has a replacement. Open that one instead.'
      using errcode='check_violation';
  end if;

  -- orders carries unique (business_id, order_no), so the replacement needs a
  -- distinct reference. -R, -R2, -R3 ... until one is free.
  if v_o.order_no is not null then
    v_no := v_o.order_no || '-R';
    while exists (select 1 from orders where business_id = v_o.business_id and order_no = v_no) loop
      v_n := v_n + 1;
      v_no := v_o.order_no || '-R' || v_n;
    end loop;
  end if;

  insert into orders (account_id, business_id, location_id, customer_id, channel_id,
                      order_no, order_date, status, created_by, replaces, order_discount)
  values (v_o.account_id, v_o.business_id, v_o.location_id, v_o.customer_id, v_o.channel_id,
          v_no, v_o.order_date, 'draft', auth.uid(), v_o.id, v_o.order_discount)
  returning id into v_new;

  insert into order_lines (account_id, order_id, recipe_id, variant_id, description,
                           qty, unit_price, discount_amount)
  select ol.account_id, v_new, ol.recipe_id, ol.variant_id, ol.description,
         ol.qty, ol.unit_price, ol.discount_amount
  from order_lines ol where ol.order_id = v_o.id;
  get diagnostics v_lines = row_count;

  return jsonb_build_object('reissued', true,
    'replaces', p_voided_order_id, 'new_order_id', v_new, 'order_no', v_no,
    'lines_copied', v_lines, 'next_step', 'edit_the_wrong_line_then_confirm');
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Recompute every dish of a business
-- ---------------------------------------------------------------------------
create or replace function fn_recompute_business_recipes(p_business_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_account uuid; r record; v record; v_n integer := 0;
begin
  select account_id into v_account from businesses where id = p_business_id and deleted_at is null;
  if v_account is null then raise exception 'Business % not found', p_business_id; end if;
  perform fn_require_cost_access(v_account);

  for r in select id from recipes
            where business_id = p_business_id and deleted_at is null
            order by created_at
  loop
    perform fn_compute_recipe_cost_snapshot(r.id);
    for v in select id from recipe_variants where recipe_id = r.id and is_active loop
      perform fn_compute_variant_cost_snapshot(v.id);
    end loop;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$fn$;

revoke all on function fn_recompute_business_recipes(uuid) from public, anon;
grant execute on function fn_recompute_business_recipes(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Self-check
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  if (select count(*) from pg_policies where schemaname='public') <> 118 then
    raise exception '0060 self-check FAILED: 0060 must add no policy.';
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 98 then
    raise exception '0060 self-check FAILED: fn_* count is %, expected 98.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_ingredients_base_unit_locked') then
    raise exception '0060 self-check FAILED: the base-unit lock trigger is missing.';
  end if;
  if not exists (select 1 from pg_indexes where indexname='ix_fk_purchases_replaced_by') then
    raise exception '0060 self-check FAILED: purchases.replaced_by has no covering index.';
  end if;
  foreach f in array array['fn_correct_purchase','fn_reissue_order','fn_recompute_business_recipes',
                           'fn_trg_ingredient_base_unit_locked'] loop
    if (select count(*) from pg_proc p where p.proname=f and p.pronamespace='public'::regnamespace
          and has_function_privilege('anon', p.oid, 'execute')) <> 0 then
      raise exception '0060 self-check FAILED: anon can call %.', f;
    end if;
    if (select count(*) from pg_proc p where p.proname=f and p.pronamespace='public'::regnamespace
          and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=public%') <> 0 then
      raise exception '0060 self-check FAILED: % has no pinned search_path.', f;
    end if;
  end loop;
  raise notice '0060 OK: purchases.replaced_by, customers.deleted_at, fn_correct_purchase, '
    'fn_reissue_order copies lines, fn_recompute_business_recipes, base unit locked.';
end
$$;
