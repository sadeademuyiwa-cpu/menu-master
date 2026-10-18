-- ============================================================================
-- 0066 ROLLBACK: the trial gate comes off. Back at 0064 (or 0065).
--
-- Restores the 16 functions 0066 replaced, word for word as 0064 left them
-- (each checked by md5 at the end), puts back the 0018 units policy and drops
-- fn_trial_end, fn_require_entitled and fn_record_order_payment.
--
-- ROLL THE APP BACK FIRST. The sale page from the 0066 release records
-- payments through fn_record_order_payment; once this has run, that call
-- fails. The earlier sale page updates orders directly and works again.
--
-- WHAT IS NOT UNDONE
--   Trials 0066 moved to the end of their Lagos day stay there: moving them
--   back would take hours from people still trialling. Their
--   subscription_changes rows stay too (the table is append only), and each
--   reads "0066: ...". A trial created while 0066 was in keeps its
--   23:59:59 Lagos end.
--
-- REFUSES TO RUN while anything newer than 0066 is applied (0067 or later):
--   * if any function 0066 replaced is no longer the 0066 definition (a later
--     migration, or a hand edit, replaced it again);
--   * if the fn_* count is not 102 or the policy count is not 118;
--   * if any table, view, fn_* function, trigger or policy in public was
--     created after 0066's own objects (catalogue oids only grow).
--   Roll the later migration back first. 0067 does not exist yet, so these
--   are the checks that will hold whatever it adds.
-- ============================================================================
drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0066 rollback ABORT: this executor is not honouring transaction control. '
      'Run it with psql --single-transaction.';
  end if;
end
$guard$;
drop table _tx_probe;

create temp table _mm0066_rb (sig text primary key, md5_0064 text not null, md5_0066 text not null) on commit drop;
insert into _mm0066_rb values
  ('public.fn_post_purchase(uuid)', '16d9ae64b823fe3d78de5462368aa58e', '3baa4b45661b7b9948c70b7213daa42f'),
  ('public.fn_correct_purchase(uuid,date,uuid,text,text,jsonb)', '3095b702a25df9da3619c72f13cdc564', 'ffb78d3a00c1e3c77a503a94b30fcd3d'),
  ('public.fn_reverse_purchase(uuid,text)', 'ac352ce89d9a1f5510e3e41b8917d9ed', '02a52f2afed43371d54f7052fb905d49'),
  ('public.fn_recompute_business_recipes(uuid)', '2ada56ea6b542994b2f568d86bd5dc1d', '43c0f196cf0d854f8896e427f0bc6ad8'),
  ('public.fn_recompute_recipes_for_ingredient(uuid,date)', 'eda4192882306f7caf6214d479d0b59a', 'f9b6dd34b34a4cfcc5b563b90ad2957a'),
  ('public.fn_compute_recipe_cost_snapshot(uuid,date,uuid)', '4a797100e1c9528ca129737a00827226', '3e95912c9a530966cc689c6ec5ec1f0d'),
  ('public.fn_compute_variant_cost_snapshot(uuid,date)', '1345e544bdfa4c6c2b3ccade40489b83', 'ca0a3057f1f8d2c3369f35a5cc3d1efb'),
  ('public.fn_clone_starter_catalog(uuid,business_type)', '0224cd77493b10a27d8532937c0a3613', '46df13fffaa772531f567da80a5a4883'),
  ('public.fn_confirm_order(uuid)', '0cf5c14e87b81f11d14e87ec159fd574', '9589b265f52b37efc65ce1107d3c9b6f'),
  ('public.fn_finalise_order(uuid)', '9f9261747a0696da2ba3685405d291ad', '71ae07baed2ea4304ec0820de6d5553f'),
  ('public.fn_reissue_order(uuid)', '3464b49003e2d23b605440301e4e0510', '3e8c3b33688c09e73af82c5929eeb667'),
  ('public.fn_void_order(uuid,text)', '619ce2471c80cb8300dba27509e5fec5', '2c5db29d988fa50102a7440dd4147dd7'),
  ('public.fn_void_sales_entry(uuid,text)', '35eec0a0d43d71313802c22aa856be71', '9ec91feee8c05c741ae4fac4e7a2ebc6'),
  ('public.fn_create_account_and_business(text,text,business_type,uuid,text,text,integer,text,uuid)', '5f0ce0623573b39f28b390af5585936f', '96ded464b05e6184053884c67ae5fcfc'),
  ('public.fn_guard_subscription_writes()', 'c54df9df6edb9ed651f57ce4b8259cd1', '8402a31db4b65d460d489f503c6f81bf'),
  ('public.fn_my_entitlement_status()', '5bdd2fc80c1fe2cf0d3e1d5c7550755b', '24b8f2140aa3ed21e6dabad53867cf10');

do $$
declare r record; v_bad text := ''; v_mark oid; v_later text;
begin
  if to_regprocedure('public.fn_require_entitled(uuid, boolean)') is null
     or to_regprocedure('public.fn_trial_end(timestamptz)') is null
     or to_regprocedure('public.fn_record_order_payment(uuid, numeric, public.payment_status)') is null then
    raise exception '0066 rollback: fn_require_entitled, fn_trial_end or fn_record_order_payment is missing; 0066 is not applied.';
  end if;

  for r in select sig, md5_0066, md5(pg_get_functiondef(to_regprocedure(sig))) as live
             from _mm0066_rb order by sig loop
    if r.live is distinct from r.md5_0066 then
      v_bad := v_bad || E'\n  ' || r.sig;
    end if;
  end loop;
  if v_bad <> '' then
    raise exception '0066 rollback REFUSED: these functions were changed after 0066 (a later migration '
                    'or a hand edit). Roll that change back first:%', v_bad;
  end if;

  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 102
     or (select count(*) from pg_policies where schemaname='public') <> 118 then
    raise exception '0066 rollback REFUSED: % fn_* and % policies, expected 102 and 118 as 0066 left them. '
                    'A later migration (0067 or after) is applied; roll it back first.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%'),
      (select count(*) from pg_policies where schemaname='public');
  end if;

  -- 0066's newest objects: its three functions and the units policy.
  select greatest(to_regprocedure('public.fn_trial_end(timestamptz)')::oid,
                  to_regprocedure('public.fn_require_entitled(uuid, boolean)')::oid,
                  to_regprocedure('public.fn_record_order_payment(uuid, numeric, public.payment_status)')::oid,
                  (select oid from pg_policy where polname = 'p_units_write' and polrelid = 'public.units'::regclass))
    into v_mark;
  select string_agg(x, ', ') into v_later from (
    select 'table/view ' || relname as x from pg_class
     where relnamespace = 'public'::regnamespace and oid > v_mark and relkind in ('r','p','v','m')
    union all
    select 'function ' || proname from pg_proc
     where pronamespace = 'public'::regnamespace and oid > v_mark and proname like 'fn\_%'
    union all
    select 'policy ' || polname from pg_policy p join pg_class c on c.oid = p.polrelid
     where c.relnamespace = 'public'::regnamespace and p.oid > v_mark
    union all
    select 'trigger ' || tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relnamespace = 'public'::regnamespace and t.oid > v_mark and not t.tgisinternal
  ) l;
  if v_later is not null then
    raise exception '0066 rollback REFUSED: created after 0066, so a later migration is applied: %. '
                    'Roll it back first.', v_later;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. The 16 functions, exactly as 0064 left them
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_post_purchase(p_purchase_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_p purchases%rowtype; v_blockers jsonb; v_zero jsonb; v_lines integer;
  v_written integer := 0; r record; v_base numeric;
begin
  select * into v_p from purchases where id = p_purchase_id for update;
  if not found then raise exception 'Purchase % not found', p_purchase_id; end if;

  perform fn_require_account_role(v_p.account_id,
    array['owner','manager','accountant']::member_role[], 'posting purchases');

  if v_p.status <> 'draft' then
    raise exception 'Purchase % is already %', p_purchase_id, v_p.status
      using errcode='check_violation';
  end if;

  select count(*) into v_lines from purchase_lines where purchase_id = p_purchase_id;
  if v_lines = 0 then
    raise exception 'Purchase % has no lines', p_purchase_id using errcode='check_violation';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'purchase_line_id', pl.id, 'ingredient_id', pl.ingredient_id,
           'ingredient_name', i.name, 'amount', pl.amount,
           'problem', 'zero_value_line')), '[]'::jsonb)
    into v_zero
  from purchase_lines pl join ingredients i on i.id = pl.ingredient_id
  where pl.purchase_id = p_purchase_id and pl.amount <= 0;

  if jsonb_array_length(v_zero) > 0 then
    return jsonb_build_object('posted', false, 'reason', 'zero_value_lines', 'blockers', v_zero);
  end if;

  v_blockers := fn_purchase_blockers(p_purchase_id);
  if jsonb_array_length(v_blockers) > 0 then
    return jsonb_build_object('posted', false,
      'reason', 'unresolved_conversions', 'blockers', v_blockers);
  end if;

  for r in select * from purchase_lines where purchase_id = p_purchase_id loop
    v_base := fn_resolve_qty_to_base(r.ingredient_id, r.qty, r.unit_id);
    if v_base is null or v_base <= 0 then
      raise exception 'Line % did not resolve. Refusing to post.', r.id
        using errcode='check_violation';
    end if;
    update purchase_lines set qty_base = v_base where id = r.id;
    insert into ingredient_prices (
      account_id, ingredient_id, supplier_id, purchase_line_id,
      qty_base, amount, source, effective_date, entered_by)
    values (v_p.account_id, r.ingredient_id, v_p.supplier_id, r.id,
      v_base, r.amount, 'purchase', v_p.purchase_date, auth.uid());
    v_written := v_written + 1;
  end loop;

  update purchases set status='posted', posted_at=now(), posted_by=auth.uid()
   where id = p_purchase_id;

  return jsonb_build_object('posted', true,
    'purchase_id', p_purchase_id, 'price_rows_written', v_written);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_correct_purchase(p_original_id uuid, p_purchase_date date, p_supplier_id uuid, p_reference text, p_note text, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.fn_reverse_purchase(p_purchase_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_p purchases%rowtype; v_rev_id uuid; v_marked integer;
begin
  select * into v_p from purchases where id = p_purchase_id for update;
  if not found then raise exception 'Purchase % not found', p_purchase_id; end if;

  perform fn_require_account_role(v_p.account_id,
    array['owner','manager','accountant']::member_role[], 'reversing purchases');

  if v_p.status <> 'posted' then
    raise exception 'Only a posted purchase can be reversed. This one is %', v_p.status
      using errcode='check_violation';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reversal requires a reason' using errcode='check_violation';
  end if;

  insert into purchases (
    account_id, business_id, location_id, supplier_id, purchase_date,
    reference, note, status, reverses, reversal_reason, created_by, posted_at, posted_by)
  values (
    v_p.account_id, v_p.business_id, v_p.location_id, v_p.supplier_id, current_date,
    coalesce(v_p.reference,'') || ' (reversal)', v_p.note, 'reversed',
    v_p.id, p_reason, auth.uid(), now(), auth.uid())
  returning id into v_rev_id;

  update ingredient_prices ip
     set reversed_at = now(), reversed_by_purchase_id = v_rev_id
   where ip.purchase_line_id in (select id from purchase_lines where purchase_id = p_purchase_id)
     and ip.reversed_at is null;
  get diagnostics v_marked = row_count;

  update purchases set status = 'reversed' where id = p_purchase_id;

  return jsonb_build_object('reversed', true,
    'original_purchase_id', p_purchase_id, 'reversal_purchase_id', v_rev_id,
    'price_rows_reversed', v_marked);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_recompute_business_recipes(p_business_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.fn_recompute_recipes_for_ingredient(p_ingredient_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_n integer := 0; v_acct uuid;
begin
  select account_id into v_acct from ingredients where id = p_ingredient_id;
  if v_acct is null then return 0; end if;
  perform fn_require_cost_access(v_acct);         -- AUTHORIZATION

  for v_id in select * from fn_recipes_using_ingredient(p_ingredient_id) loop
    perform fn_compute_recipe_cost_snapshot(v_id, p_as_of, auth.uid());
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_compute_recipe_cost_snapshot(p_recipe_id uuid, p_as_of date DEFAULT CURRENT_DATE, p_created_by uuid DEFAULT auth.uid())
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r recipes%rowtype; bs business_settings%rowtype; core recipe_cost_result;
  v_overhead numeric := 0; v_oh_total numeric; v_oh_rate numeric;
  v_sold_by_format boolean;
  v_required integer; v_priced integer; v_unpriced jsonb; v_complete boolean;
  v_floor_pp numeric; v_snapshot uuid;
begin
  select * into r from recipes where id = p_recipe_id and deleted_at is null;
  if not found then raise exception 'Recipe % not found', p_recipe_id; end if;

  perform fn_require_cost_access(r.account_id);   -- AUTHORIZATION

  select * into bs from business_settings where business_id = r.business_id;
  if not found then
    raise exception 'Business settings missing for business %', r.business_id;
  end if;

  core := fn__recipe_cost_core(p_recipe_id, p_as_of, 0);

  v_required := core.required_inputs;
  v_priced   := core.priced_inputs;
  v_unpriced := core.unpriced_items;
  v_complete := core.is_complete;

  -- MODEL 1 vs MODEL 2 (owner decision, Phase 4 escalation).
  -- A recipe sold through its own business-defined formats does not need a
  -- portion size: the FORMAT is the commercial unit, and fn_variant_cost
  -- allocates the batch economics to each format. A recipe with no active
  -- sellable format is portion-based and still requires one. This is not
  -- "portion is optional" -- exactly one basis applies, and which one is
  -- determined here rather than guessed.
  select exists (
    select 1
      from recipe_variants rv
      join serving_formats sf on sf.id = rv.format_id
     where rv.recipe_id = p_recipe_id
       and rv.is_active
       and sf.is_active
  ) into v_sold_by_format;

  if bs.overhead_enabled then
    v_required := v_required + 1;

    -- 0041: the reason now comes from fn_overhead_problem, which reads each
    -- overhead item's OWN basis and falls back to the business default. The
    -- decision is made once, in one place, rather than re-derived here.
    declare v_oh_problem text;
    begin
      v_oh_problem := fn_overhead_problem(r.business_id, r.yield_unit_id);
      if v_oh_problem is not null then
        v_complete := false;
        v_unpriced := v_unpriced || jsonb_build_object(
          'recipe_id', p_recipe_id, 'business_id', r.business_id,
          'problem', v_oh_problem);
        v_overhead := null;
      else
        v_oh_rate := fn_overhead_rate(r.business_id, r.yield_unit_id);
        if r.portion_qty is null then
          -- No portion size. For a FORMAT-BASED recipe that is correct:
          -- overhead is allocated per format by fn_variant_cost as
          -- overhead_rate x resolved_qty, so there is no per-portion figure
          -- to compute and none is invented.
          v_overhead := null;
          if v_sold_by_format then
            v_priced := v_priced + 1;
          end if;
        else
          v_overhead := v_oh_rate * r.portion_qty;
          v_priced   := v_priced + 1;
        end if;
      end if;
    end;
  end if;

  if r.kind = 'dish' and not v_sold_by_format then
    -- MODEL 1, portion-based: the portion is the commercial unit, so its size
    -- is a required input.
    v_required := v_required + 1;
    if r.portion_qty is null then
      v_complete := false;
      v_unpriced := v_unpriced || jsonb_build_object(
        'recipe_id', p_recipe_id, 'problem', 'missing_portion_size');
    else
      v_priced := v_priced + 1;
    end if;
  end if;
  -- MODEL 2, format-based: no portion input is required and none is invented.
  -- Whether each format can actually be costed is decided per format by
  -- fn_variant_problem, which blocks on incompatible dimensions, missing
  -- conversions and unpriced packaging. A recipe can therefore be complete
  -- while one of its formats is not, which is the truth of the situation.

  if core.priced_inputs = 0 then
    v_floor_pp := null;
  elsif core.cost_per_yield_unit is not null and r.portion_qty is not null then
    v_floor_pp := core.cost_per_yield_unit * r.portion_qty + coalesce(v_overhead, 0);
  else
    v_floor_pp := null;
  end if;

  if jsonb_array_length(v_unpriced) > 0 then
    v_complete := false;
  end if;

  insert into cost_snapshots (
    account_id, business_id, recipe_id, computed_at,
    costing_method, wavg_window_days,
    is_complete, required_inputs, priced_inputs, excluded_inputs, unpriced_items,
    ingredient_cost, packaging_cost, labour_cost, overhead_cost,
    batch_cost, cost_per_yield_unit, cost_per_portion,
    floor_batch_cost, floor_cost_per_yield_unit, floor_cost_per_portion,
    created_by,
    portion_qty_at_snapshot)
  values (
    r.account_id, r.business_id, p_recipe_id, now(),
    bs.costing_method, bs.wavg_window_days,
    v_complete, v_required, v_priced, core.excluded_inputs, v_unpriced,
    core.ingredient_cost, core.packaging_cost, core.labour_cost, v_overhead,
    case when v_complete then core.batch_cost end,
    case when v_complete then core.cost_per_yield_unit end,
    case when v_complete then v_floor_pp end,
    case when core.priced_inputs > 0 then core.batch_cost end,
    case when core.priced_inputs > 0 then core.cost_per_yield_unit end,
    v_floor_pp,
    p_created_by,
    -- 0046: the portion size actually used, recorded so the breakdown can be
    -- rebuilt later. recipes.portion_qty is mutable; this is not.
    r.portion_qty)
  returning id into v_snapshot;

  return v_snapshot;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_compute_variant_cost_snapshot(p_variant_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v record; base cost_snapshots%rowtype; c variant_cost_components;
  v_problem text; v_complete boolean; v_unpriced jsonb; v_id uuid;
begin
  select rv.account_id, rv.business_id, rv.recipe_id, rv.format_id,
         rv.costing_basis, r.yield_unit_id
    into v
    from recipe_variants rv
    join recipes r on r.id = rv.recipe_id
   where rv.id = p_variant_id;
  if v is null then
    raise exception 'Variant % does not exist', p_variant_id;
  end if;
  perform fn_require_cost_access(v.account_id);

  select * into base from cost_snapshots
   where recipe_id = v.recipe_id and variant_id is null
   order by computed_at desc, seq desc limit 1;
  if not found then
    raise exception 'Recipe % has no cost snapshot yet. Compute the recipe '
                    'cost before the variant cost.', v.recipe_id;
  end if;

  v_problem := fn_variant_problem(p_variant_id);
  c         := fn_variant_cost_components(p_variant_id);

  -- Completeness propagates upward exactly as it does for sub-recipes: a
  -- variant is complete only if its own basis resolves AND the recipe beneath
  -- it is complete.
  v_complete := base.is_complete and v_problem is null and c.total is not null;
  v_unpriced := coalesce(base.unpriced_items, '[]'::jsonb);
  if v_problem is not null then
    v_unpriced := v_unpriced || jsonb_build_object(
      'variant_id', p_variant_id, 'problem', v_problem);
  end if;

  insert into cost_snapshots (
      account_id, business_id, recipe_id, computed_at,
      costing_method, wavg_window_days,
      is_complete, required_inputs, priced_inputs, excluded_inputs, unpriced_items,
      ingredient_cost, packaging_cost, labour_cost, overhead_cost,
      batch_cost, cost_per_yield_unit, cost_per_portion,
      floor_batch_cost, floor_cost_per_yield_unit, floor_cost_per_portion,
      created_by,
      variant_id, resolved_qty, resolved_unit_id, basis_used, format_packaging_cost,
      portion_qty_at_snapshot, variant_overhead_cost)
  values (
      v.account_id, v.business_id, v.recipe_id, now(),
      base.costing_method, base.wavg_window_days,
      v_complete, base.required_inputs, base.priced_inputs, base.excluded_inputs,
      v_unpriced,
      base.ingredient_cost, base.packaging_cost, base.labour_cost, base.overhead_cost,
      base.batch_cost, base.cost_per_yield_unit,
      c.total,                                  -- cost per SOLD UNIT, not per portion
      base.floor_batch_cost, base.floor_cost_per_yield_unit, base.floor_cost_per_portion,
      auth.uid(),
      p_variant_id, c.resolved_qty, v.yield_unit_id, v.costing_basis, c.packaging,
      -- a format-based sale has no portion; the sold unit IS the portion
      base.portion_qty_at_snapshot, c.overhead)
  returning id into v_id;

  return v_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.fn_clone_starter_catalog(p_account_id uuid, p_type business_type DEFAULT NULL::business_type)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_count integer;
begin
  perform fn_require_account_role(p_account_id,
    array['owner']::member_role[], 'loading the starter catalogue');  -- AUTHORIZATION

  insert into ingredient_categories (account_id, name)
  select p_account_id, c.name from catalog_categories c
  where not exists (select 1 from ingredient_categories ic
                     where ic.account_id = p_account_id and ic.name = c.name);

  insert into ingredients (account_id, kind, name, category_id, base_unit_id)
  select p_account_id, ci.kind, ci.name, ic.id, u.id
  from catalog_ingredients ci
  join ingredient_categories ic on ic.account_id = p_account_id and ic.name = ci.category_name
  join units u on u.account_id is null and u.code = ci.base_unit
  where (ci.applies_to is null or p_type is null or p_type = any(ci.applies_to))
    and not exists (select 1 from ingredients i
                     where i.account_id = p_account_id and lower(i.name) = lower(ci.name));

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_confirm_order(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_o        orders%rowtype;
  v_lines    integer;
  v_subtotal numeric(14,2);
  v_costed   integer;
begin
  select * into v_o from orders where id = p_order_id for update;
  if not found then raise exception 'Order % not found', p_order_id; end if;

  perform fn_require_account_role(v_o.account_id,
    array['owner','manager','sales']::member_role[], 'confirming orders');

  if v_o.voided_at is not null then
    raise exception 'Order % is voided and cannot be confirmed', p_order_id
      using errcode='check_violation';
  end if;
  if v_o.finalised_at is not null then
    raise exception 'Order % is already confirmed', p_order_id
      using errcode='check_violation';
  end if;

  select count(*), coalesce(sum(qty * unit_price - discount_amount), 0)
    into v_lines, v_subtotal
    from order_lines where order_id = p_order_id;

  if v_lines = 0 then
    raise exception 'Order % has no lines', p_order_id using errcode='check_violation';
  end if;

  -- The order-level check 0044 could not express as a CHECK constraint. A
  -- draft is allowed to be temporarily inconsistent; a confirmed sale is not.
  if v_o.order_discount > v_subtotal then
    raise exception
      'The order discount of % is more than the order is worth (%). Lower the discount before confirming.',
      to_char(v_o.order_discount, 'FM999999990.00'),
      to_char(v_subtotal, 'FM999999990.00')
      using errcode='check_violation';
  end if;

  -- Opens the one-way window in fn_guard_frozen_cost. SET LOCAL: it is gone at
  -- the end of this transaction whether it commits or rolls back.
  perform set_config('menumaster.confirming_order', p_order_id::text, true);

  -- Every line, one statement, one instant. A dish line freezes its snapshot
  -- cost; a non-dish line freezes the cost the owner typed for it (0061),
  -- or stays NULL and is reported as sold without a known cost.
  update order_lines ol
     set cost_snapshot_id  = f.cost_snapshot_id,
         unit_cost_at_sale = coalesce(f.unit_cost_at_sale,
                                      case when ol.recipe_id is null then ol.extra_unit_cost end)
    from (
      select l.id, c.cost_snapshot_id, c.unit_cost_at_sale
        from order_lines l
        cross join lateral fn_frozen_sale_cost(l.account_id, l.recipe_id, l.variant_id) c
       where l.order_id = p_order_id
    ) f
   where ol.id = f.id;

  perform set_config('menumaster.confirming_order', '', true);

  select count(*) into v_costed
    from order_lines where order_id = p_order_id and unit_cost_at_sale is not null;

  update orders
     set status       = 'confirmed',
         finalised_at = now(),
         finalised_by = auth.uid()
   where id = p_order_id;

  return jsonb_build_object(
    'confirmed',          true,
    'order_id',           p_order_id,
    'lines_frozen',       v_lines,
    'lines_without_cost', v_lines - v_costed);
end
$function$;

CREATE OR REPLACE FUNCTION public.fn_finalise_order(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  v := fn_confirm_order(p_order_id);
  return jsonb_build_object(
    'finalised', true,
    'order_id',  p_order_id,
    'lines',     v->'lines_frozen');
end
$function$;

CREATE OR REPLACE FUNCTION public.fn_reissue_order(p_voided_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                           qty, unit_price, discount_amount, extra_unit_cost)
  select ol.account_id, v_new, ol.recipe_id, ol.variant_id, ol.description,
         ol.qty, ol.unit_price, ol.discount_amount, ol.extra_unit_cost
  from order_lines ol where ol.order_id = v_o.id;
  get diagnostics v_lines = row_count;

  return jsonb_build_object('reissued', true,
    'replaces', p_voided_order_id, 'new_order_id', v_new, 'order_no', v_no,
    'lines_copied', v_lines, 'next_step', 'edit_the_wrong_line_then_confirm');
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_void_order(p_order_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_o orders%rowtype;
begin
  select * into v_o from orders where id = p_order_id for update;
  if not found then raise exception 'Order % not found', p_order_id; end if;

  perform fn_require_account_role(v_o.account_id,
    array['owner','manager']::member_role[], 'voiding sales');

  if v_o.finalised_at is null then
    raise exception 'Only a finalised order can be voided. Delete the draft instead.'
      using errcode='check_violation';
  end if;
  if v_o.voided_at is not null then
    raise exception 'Order % is already voided', p_order_id using errcode='check_violation';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A void requires a reason' using errcode='check_violation';
  end if;

  update orders
     set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   where id = p_order_id;

  return jsonb_build_object('voided', true, 'order_id', p_order_id, 'reason', btrim(p_reason));
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_void_sales_entry(p_entry_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_e sales_entries%rowtype;
begin
  select * into v_e from sales_entries where id = p_entry_id for update;
  if not found then raise exception 'Sales entry % not found', p_entry_id; end if;

  perform fn_require_account_role(v_e.account_id,
    array['owner','manager']::member_role[], 'voiding sales');

  if v_e.voided_at is not null then
    raise exception 'Sales entry % is already voided', p_entry_id using errcode='check_violation';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A void requires a reason' using errcode='check_violation';
  end if;

  update sales_entries
     set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   where id = p_entry_id;

  return jsonb_build_object('voided', true, 'sales_entry_id', p_entry_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_create_account_and_business(p_account_name text, p_business_name text, p_business_type business_type DEFAULT 'other'::business_type, p_user_id uuid DEFAULT auth.uid(), p_currency text DEFAULT 'NGN'::text, p_plan_id text DEFAULT 'trial'::text, p_trial_days integer DEFAULT 14, p_idempotency_key text DEFAULT NULL::text, p_account_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_account uuid; v_business uuid; v_location uuid; v_slug text;
  v_cloned integer := 0; v_user uuid;
  v_fp text; v_row onboarding_requests%rowtype;
  v_owned_accounts uuid[]; v_account_created boolean := false;
begin
  -- ---- authorization: unchanged from the pre-C10 function --------------
  if fn_is_service_context() then
    v_user := coalesce(p_user_id, auth.uid());
  else
    v_user := auth.uid();
    if p_user_id is not null and p_user_id <> v_user then
      raise exception 'You may only create an account for yourself'
        using errcode = '42501';
    end if;
  end if;

  if v_user is null then
    raise exception 'A user is required to own the account';
  end if;
  if not exists (select 1 from auth.users where id = v_user) then
    raise exception 'User % does not exist', v_user;
  end if;
  if coalesce(btrim(p_account_name),'') = '' or coalesce(btrim(p_business_name),'') = '' then
    raise exception 'Account name and business name are required';
  end if;

  -- ---- C10: the key is mandatory in effect ------------------------------
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'An idempotency key is required for onboarding. Generate '
                    'one per onboarding attempt and reuse it for every retry.'
      using errcode = '22023';
  end if;

  -- ---- canonical payload fingerprint ------------------------------------
  -- jsonb, not json: jsonb normalises key order, so the text form is canonical
  -- and cannot depend on how the caller ordered anything. Every input that can
  -- change the provisioning outcome is included.
  v_fp := md5(jsonb_build_object(
            'account_name',  btrim(p_account_name),
            'business_name', btrim(p_business_name),
            'business_type', p_business_type::text,
            'currency',      upper(btrim(coalesce(p_currency, 'NGN'))),
            'plan_id',       btrim(coalesce(p_plan_id, 'trial')),
            'trial_days',    coalesce(p_trial_days, 14),
            'account_id',    coalesce(p_account_id::text, '')
          )::text);

  -- ---- serialise concurrent onboarding for this one user ----------------
  -- Not the guarantee -- the primary key is. This only stops the loser of a
  -- race doing ~180 inserts it will immediately discard.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  -- ---- replay ------------------------------------------------------------
  select * into v_row from onboarding_requests
   where user_id = v_user and idempotency_key = p_idempotency_key;

  if found then
    if v_row.payload_fingerprint <> v_fp then
      raise exception 'Idempotency key % was already used with a different '
                      'payload. Use a new key to create something different.',
                      p_idempotency_key
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'account_id',            v_row.account_id,
      'business_id',           v_row.business_id,
      'location_id',           v_row.location_id,
      'ingredients_added',     v_row.ingredients_added,
      'account_created',       v_row.account_created,
      'idempotent_replay',     true,
      'originally_created_at', v_row.created_at,
      'next_step',             case when exists (
                                      select 1 from ingredient_prices ip
                                       where ip.account_id = v_row.account_id)
                                    then 'continue' else 'enter_your_own_prices' end);
  end if;

  -- ---- resolve the account ----------------------------------------------
  select array_agg(distinct m.account_id) into v_owned_accounts
    from memberships m
   where m.user_id = v_user and m.role = 'owner';

  if p_account_id is not null then
    if not (p_account_id = any(coalesce(v_owned_accounts, array[]::uuid[]))) then
      raise exception 'You do not own account %, so you cannot add a business '
                      'to it.', p_account_id using errcode = '42501';
    end if;
    v_account := p_account_id;
  elsif v_owned_accounts is null or array_length(v_owned_accounts, 1) is null then
    v_account := null;                                   -- first onboarding
  elsif array_length(v_owned_accounts, 1) = 1 then
    v_account := v_owned_accounts[1];                    -- the one account
  else
    raise exception 'You own % accounts, so which one this business belongs to '
                    'is ambiguous. Pass p_account_id explicitly.',
                    array_length(v_owned_accounts, 1)
      using errcode = '21000';
  end if;

  begin
    -- ---- first onboarding: account, membership, catalogue, trial --------
    if v_account is null then
      insert into accounts (name) values (btrim(p_account_name))
        returning id into v_account;

      insert into memberships (account_id, business_id, user_id, role)
      values (v_account, null, v_user, 'owner');

      v_account_created := true;
    end if;

    v_slug := btrim(regexp_replace(lower(btrim(p_business_name)),
                                   '[^a-z0-9]+', '-', 'g'), '-');
    insert into businesses (account_id, name, slug, type)
    values (v_account, btrim(p_business_name), v_slug, p_business_type)
    returning id into v_business;

    insert into locations (account_id, business_id, name, is_default)
    values (v_account, v_business, 'Main', true) returning id into v_location;

    insert into business_settings (business_id, account_id, currency)
    values (v_business, v_account, p_currency);

    insert into channels (account_id, business_id, name, is_default)
    values (v_account, v_business, 'Direct', true);

    -- The starter catalogue and the trial belong to the ACCOUNT, not the
    -- business, so a second business under an existing account gets neither.
    if v_account_created then
      v_cloned := fn_clone_starter_catalog(v_account, p_business_type);

      insert into subscriptions (account_id, plan_id, status,
                                 trial_ends_at, current_period_end)
      values (v_account, p_plan_id, 'trialing',
              now() + (p_trial_days || ' days')::interval,
              now() + (p_trial_days || ' days')::interval);
    end if;

    insert into onboarding_requests (
      user_id, idempotency_key, payload_fingerprint,
      account_id, business_id, location_id, ingredients_added, account_created)
    values (v_user, p_idempotency_key, v_fp,
            v_account, v_business, v_location, v_cloned, v_account_created);

  exception when unique_violation then
    -- A concurrent caller won the race. Everything above, including all
    -- provisioning, is rolled back with this block. Re-read and replay.
    -- This handler must never fall through to continue provisioning.
    select * into v_row from onboarding_requests
     where user_id = v_user and idempotency_key = p_idempotency_key;

    if not found then
      raise;    -- a different unique violation: surface it, do not mask it
    end if;

    return jsonb_build_object(
      'account_id',            v_row.account_id,
      'business_id',           v_row.business_id,
      'location_id',           v_row.location_id,
      'ingredients_added',     v_row.ingredients_added,
      'account_created',       v_row.account_created,
      'idempotent_replay',     true,
      'originally_created_at', v_row.created_at,
      'next_step',             'enter_your_own_prices');
  end;

  return jsonb_build_object(
    'account_id', v_account, 'business_id', v_business, 'location_id', v_location,
    'ingredients_added', v_cloned, 'account_created', v_account_created,
    'idempotent_replay', false, 'next_step', 'enter_your_own_prices');
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_guard_subscription_writes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_existing integer;
begin
  if fn_is_service_context() then
    return coalesce(new, old);
  end if;

  if tg_op <> 'INSERT' then
    raise exception 'Subscription changes must go through the billing system'
      using errcode = '42501';
  end if;

  select count(*) into v_existing from subscriptions where account_id = new.account_id;
  if v_existing > 0 then
    raise exception 'This account already has a subscription' using errcode = '42501';
  end if;

  if new.status <> 'trialing'
     or not exists (select 1 from plans
                     where id = new.plan_id and is_active and is_self_serve_trial) then
    raise exception 'Only a trial subscription can be created without billing'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_my_entitlement_status()
 RETURNS TABLE(entitled boolean, status text, boundary timestamp with time zone, reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    fn_account_is_entitled(s.account_id),
    s.status,
    s.current_period_end,
    case
      when fn_account_is_entitled(s.account_id) and s.status = 'trialing' then 'trial_active'
      when fn_account_is_entitled(s.account_id) and s.status = 'past_due' then 'payment_failed_in_grace'
      when fn_account_is_entitled(s.account_id)                           then 'active'
      when s.status = 'trialing'                                          then 'trial_ended'
      when s.status = 'past_due'                                          then 'payment_failed'
      when s.status = 'cancelled'                                         then 'subscription_ended'
      else 'not_entitled'
    end
  from subscriptions s
  join memberships m on m.account_id = s.account_id and m.user_id = auth.uid()
  limit 1;
$function$;

-- ---------------------------------------------------------------------------
-- 2. The units policy as 0018 left it
-- ---------------------------------------------------------------------------
drop policy p_units_write on units;
create policy p_units_write on units
  for all to authenticated
  using      (account_id is not null and fn_is_account_member(account_id))
  with check (account_id is not null and fn_is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- 3. The three 0066 functions
-- ---------------------------------------------------------------------------
drop function fn_record_order_payment(uuid, numeric, payment_status);
drop function fn_require_entitled(uuid, boolean);
drop function fn_trial_end(timestamptz);

-- ---------------------------------------------------------------------------
-- 4. Self-check
-- ---------------------------------------------------------------------------
do $$
declare r record; v_bad text := ''; v_moved int;
begin
  for r in select sig, md5_0064, md5(pg_get_functiondef(to_regprocedure(sig))) as live
             from _mm0066_rb order by sig loop
    if r.live is distinct from r.md5_0064 then
      v_bad := v_bad || E'\n  ' || r.sig;
    end if;
  end loop;
  if v_bad <> '' then
    raise exception '0066 rollback FAILED: not restored to the 0064 definition:%', v_bad;
  end if;
  if exists (select 1 from pg_proc where pronamespace='public'::regnamespace
               and prosrc ~ 'fn_require_entitled|fn_trial_end|fn_record_order_payment') then
    raise exception '0066 rollback FAILED: a function still refers to a 0066 function.';
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='units' and policyname='p_units_write'
                    and cmd='ALL' and roles='{authenticated}'
                    and qual = '((account_id IS NOT NULL) AND fn_is_account_member(account_id))'
                    and with_check = '((account_id IS NOT NULL) AND fn_is_account_member(account_id))') then
    raise exception '0066 rollback FAILED: p_units_write is not the 0018 policy.';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 118 then
    raise exception '0066 rollback FAILED: policy count is %, expected 118.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 99 then
    raise exception '0066 rollback FAILED: fn_* count is %, expected 99.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  select count(*) into v_moved from subscription_changes where reason like '0066:%';
  raise notice '0066 rollback OK: back at 0064. The trial gate is off: an ended account can again post, '
               'correct and cancel purchases and change sales through the elevated functions. % trial '
               'move(s) recorded by 0066 stay as they are. 118 policies, 99 fn_*.', v_moved;
end
$$;
