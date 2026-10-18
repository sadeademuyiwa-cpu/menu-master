-- ============================================================================
-- MENU MASTER NG
-- 0066: once a trial has ended, nothing new is saved -- except money received
--
-- Requires: 0001-0064 applied. 0065 (help videos) is optional, but if it is to
-- ship at all it must be applied BEFORE 0066: 0065's preflight, its
-- self-check and its suite (tests/051 check 12) expect exactly 99 fn_*, and
-- 0066 makes it 102. 0066 itself does not need 0065 (0065 adds no function and
-- no policy). If 0066 is already in, 0065 and 051 must first have their fn_*
-- count changed from 99 to 102.
--
-- WHY
--   The row policies have refused writes on an ended account since 0028, but
--   13 elevated (SECURITY DEFINER) functions skip row policies, and none of
--   them asked about the trial. After the trial an account could still record,
--   correct and cancel purchases, re-cost every dish, and confirm, cancel or
--   reissue sales; a Costing-plan account could do the sales ones as well.
--   At the same time nobody could record the balance a customer paid on a sale
--   already confirmed, so a caterer's receipt said "still to pay" for ever.
--   Onboarding let a direct caller choose its own trial length, gave a staff
--   login of an ended account a fresh account and trial, and let an owner
--   add a business after the trial. A trial ended at the minute setup
--   finished, which can be the middle of a service.
--
-- THE OWNER'S DECISIONS (trial plan, 18 Oct 2026)
--   D1  A trial ends at 23:59:59 Lagos time on the 14th day after setup.
--       Trials live today move LATER to the end of their Lagos day, each with
--       one subscription_changes row. Ended trials are left alone.
--   D2  After a trial, or on Costing, owner, manager and sales can still
--       record money received on a sale that was confirmed and not cancelled.
--       Only amount_paid and payment_status change. Drafts stay locked.
--   D3  After a trial (or without Sales) a sale cannot be cancelled or
--       reissued, and a recorded purchase cannot be cancelled or corrected.
--   D4  A login that already belongs to an account cannot start a new one.
--   D7  Custom units: only the roles that edit ingredients, only with access.
--
-- HOW
--   fn_trial_end(p_from)         NEW. 23:59:59 Africa/Lagos on the 14th Lagos
--                                day after p_from. Lagos keeps one offset all
--                                year, so it is 22:59:59 UTC.
--   fn_require_entitled(acct, needs_sales)
--                                NEW. Returns at once in service context;
--                                otherwise the caller must be a member, the
--                                account must have access (SQLSTATE MMENT) and,
--                                when asked, the Sales feature (MMSAL). The
--                                message is plain English and is shown to the
--                                person as it is; it depends on why (trial
--                                ended, payment failed, plan ended) and on
--                                who (the owner chooses a plan; staff are told
--                                to ask the owner). HINT carries the reason
--                                code. Runs with the caller's rights and is
--                                granted to nobody: only the definer functions
--                                below call it.
--   13 definer write functions   REPLACED, each copied word for word from its
--                                latest definition with ONE line added straight
--                                after its existing role check:
--                                  entitlement:  fn_post_purchase,
--                                    fn_correct_purchase, fn_reverse_purchase,
--                                    fn_recompute_business_recipes,
--                                    fn_recompute_recipes_for_ingredient,
--                                    fn_compute_recipe_cost_snapshot,
--                                    fn_compute_variant_cost_snapshot,
--                                    fn_clone_starter_catalog
--                                  entitlement and Sales: fn_confirm_order,
--                                    fn_finalise_order, fn_reissue_order,
--                                    fn_void_order, fn_void_sales_entry
--                                fn_finalise_order has no role check of its own
--                                (fn_confirm_order holds it), so its gate runs
--                                only for a caller fn_confirm_order would admit.
--                                The self-check proves that removing the added
--                                line gives back the 0064 definition exactly.
--   fn_record_order_payment      NEW. Owner, manager or sales; a confirmed,
--                                not cancelled sale only; amount zero or more;
--                                only amount_paid and payment_status change.
--                                It asks for no plan and no trial (D2). Its
--                                own refusals (sale not found, cancelled,
--                                draft, amount below zero or too large, no
--                                status) are SQLSTATE MMPAY with a plain
--                                sentence; a role refusal stays 42501.
--   fn_create_account_and_business
--                                REPLACED. For anyone but the operator: a trial
--                                other than 14 days is refused (22023), a login
--                                that is already staff somewhere is refused
--                                (MMLGN), adding a business needs access
--                                (MMENT). The trial row now goes in before the
--                                starter catalogue (which is now gated) and
--                                ends at fn_trial_end(now()). The replay of a
--                                retried onboarding still comes first.
--   fn_guard_subscription_writes REPLACED. A trial created outside service
--                                context must end at fn_trial_end(now()), with
--                                trial_ends_at equal to current_period_end.
--   fn_my_entitlement_status     REPLACED. Same columns; it now names the
--                                caller's OLDEST membership, as fn_my_has_sales
--                                and the app already do.
--   p_units_write                REPLACED under the same name: owner, manager
--                                or kitchen (the roles that edit ingredients),
--                                on an account with access.
--   live trials                  moved to 23:59:59 Lagos on their last day,
--                                only ever later, one subscription_changes row
--                                each (source 'owner', decision D1).
--
-- WHAT DOES NOT CHANGE
--   Member management stays open after a trial (0028): fn_invite_member,
--   fn_accept_invitations, fn_set_member_role, fn_remove_member and
--   fn_revoke_invitation are untouched, so an owner is never locked out of
--   their own people. Reads are never gated. The operator and the Paystack
--   webhook run in service context and are not affected. No new table.
--   Policies 118 -> 118. fn_* 99 -> 102.
--
-- KNOWN EXCEPTIONS (left as they were before 0066)
--   Two history tables still take a row from a signed-in member after a trial,
--   through row policies that have never asked about access: p_sfc_insert on
--   serving_format_changes (any member) and p_costing_method_changes_insert
--   on costing_method_changes (the owner). Such a row only describes a
--   change; the change itself (to a serving format, or to a business's
--   costing method in business_settings) is still refused, because the write
--   policies on serving_formats and business_settings ask for access. The
--   self-check's catalogue rule covers functions only, so it does not report
--   them. Gating them is a later migration (which must then move tests/018
--   check 13 and tests/022 check 24 off 70).
--
-- PREFLIGHT
--   Refuses to run unless each of the 16 functions it replaces is exactly the
--   0064 definition: md5(pg_get_functiondef) is compared with the values from
--   a fresh repository build through 0064, the same values
--   deploy/runbook/PRE_DEPLOY_0066.sql prints.
-- ============================================================================

drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0066 ABORT: this executor is not honouring transaction control '
      '(each statement is committing on its own). Run it with '
      'psql --single-transaction over the Session Pooler.';
  end if;
end
$guard$;
drop table _tx_probe;

-- ---------------------------------------------------------------------------
-- 0. Preflight
-- ---------------------------------------------------------------------------
create temp table _mm0066_expected (sig text primary key, md5_0064 text not null) on commit drop;
insert into _mm0066_expected values
  ('public.fn_post_purchase(uuid)', '16d9ae64b823fe3d78de5462368aa58e'),
  ('public.fn_correct_purchase(uuid,date,uuid,text,text,jsonb)', '3095b702a25df9da3619c72f13cdc564'),
  ('public.fn_reverse_purchase(uuid,text)', 'ac352ce89d9a1f5510e3e41b8917d9ed'),
  ('public.fn_recompute_business_recipes(uuid)', '2ada56ea6b542994b2f568d86bd5dc1d'),
  ('public.fn_recompute_recipes_for_ingredient(uuid,date)', 'eda4192882306f7caf6214d479d0b59a'),
  ('public.fn_compute_recipe_cost_snapshot(uuid,date,uuid)', '4a797100e1c9528ca129737a00827226'),
  ('public.fn_compute_variant_cost_snapshot(uuid,date)', '1345e544bdfa4c6c2b3ccade40489b83'),
  ('public.fn_clone_starter_catalog(uuid,business_type)', '0224cd77493b10a27d8532937c0a3613'),
  ('public.fn_confirm_order(uuid)', '0cf5c14e87b81f11d14e87ec159fd574'),
  ('public.fn_finalise_order(uuid)', '9f9261747a0696da2ba3685405d291ad'),
  ('public.fn_reissue_order(uuid)', '3464b49003e2d23b605440301e4e0510'),
  ('public.fn_void_order(uuid,text)', '619ce2471c80cb8300dba27509e5fec5'),
  ('public.fn_void_sales_entry(uuid,text)', '35eec0a0d43d71313802c22aa856be71'),
  ('public.fn_create_account_and_business(text,text,business_type,uuid,text,text,integer,text,uuid)', '5f0ce0623573b39f28b390af5585936f'),
  ('public.fn_guard_subscription_writes()', 'c54df9df6edb9ed651f57ce4b8259cd1'),
  ('public.fn_my_entitlement_status()', '5bdd2fc80c1fe2cf0d3e1d5c7550755b');

do $$
declare r record; v_bad text := '';
begin
  if to_regprocedure('public.fn_menu_prices()') is null then
    raise exception '0066 preflight FAILED: fn_menu_prices is missing. Apply 0064 first.';
  end if;
  if to_regprocedure('public.fn_require_entitled(uuid, boolean)') is not null
     or to_regprocedure('public.fn_trial_end(timestamptz)') is not null
     or to_regprocedure('public.fn_record_order_payment(uuid, numeric, public.payment_status)') is not null then
    raise exception '0066 preflight FAILED: a 0066 function already exists; 0066 is applied.';
  end if;
  if to_regclass('public.subscription_changes') is null then
    raise exception '0066 preflight FAILED: subscription_changes is missing (0031).';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 118 then
    raise exception '0066 preflight FAILED: policy count is %, expected 118.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 99 then
    raise exception '0066 preflight FAILED: fn_* count is %, expected 99.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='units' and policyname='p_units_write'
                    and cmd='ALL' and roles='{authenticated}'
                    and qual = '((account_id IS NOT NULL) AND fn_is_account_member(account_id))'
                    and with_check = '((account_id IS NOT NULL) AND fn_is_account_member(account_id))') then
    raise exception '0066 preflight FAILED: p_units_write is not the 0018 policy this migration replaces.';
  end if;

  -- The bodies below are copies. A copy of anything but the definition
  -- production runs would quietly undo a change, so every one must match.
  for r in select e.sig, e.md5_0064, md5(pg_get_functiondef(to_regprocedure(e.sig))) as live
             from _mm0066_expected e order by e.sig loop
    if r.live is distinct from r.md5_0064 then
      v_bad := v_bad || format(E'\n  %s: expected %s, found %s', r.sig, r.md5_0064, coalesce(r.live, 'MISSING'));
    end if;
  end loop;
  if v_bad <> '' then
    raise exception '0066 preflight FAILED: these functions are not the 0064 definitions 0066 was written against:%', v_bad;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. When a trial ends (D1)
-- ---------------------------------------------------------------------------
create function fn_trial_end(p_from timestamptz)
returns timestamptz
language sql
stable
set search_path to 'public'
as $fn$
  -- The last second of the 14th Lagos calendar day after p_from. Explicit
  -- 'Africa/Lagos' on both sides, so the session's TimeZone does not matter.
  select (((p_from at time zone 'Africa/Lagos')::date + 14) + time '23:59:59')
         at time zone 'Africa/Lagos';
$fn$;

comment on function fn_trial_end(timestamptz) is
  'When a free trial that starts at p_from ends: 23:59:59 Africa/Lagos on the '
  '14th Lagos day after it (owner decision D1, 0066). NULL in, NULL out.';

revoke all on function fn_trial_end(timestamptz) from public, anon;
grant execute on function fn_trial_end(timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The gate
-- ---------------------------------------------------------------------------
-- A separate helper, not a change to fn_require_account_role: that helper also
-- guards member management, which must stay open. An explicit call is easy to
-- find, which is what the self-check at the end relies on.
create function fn_require_entitled(p_account_id uuid, p_needs_sales boolean default false)
returns void
language plpgsql
stable
set search_path to 'public'
as $fn$
declare
  v_status text; v_owner boolean; v_reason text; v_msg text;
begin
  -- The operator and the Paystack webhook. fn_is_service_context reads the
  -- request role and JWT, not current_user, so a signed-in caller of a
  -- definer function is never mistaken for it.
  if fn_is_service_context() then return; end if;

  if p_account_id is null or not fn_is_account_member(p_account_id) then
    raise exception 'Not authorized for this account' using errcode = '42501';
  end if;

  v_owner := fn_has_account_role(p_account_id, array['owner']::member_role[]);

  if not fn_account_is_entitled(p_account_id) then
    select s.status into v_status from subscriptions s where s.account_id = p_account_id;
    v_reason := case v_status when 'trialing'  then 'trial_ended'
                              when 'past_due'  then 'payment_failed'
                              when 'cancelled' then 'subscription_ended'
                              else 'no_plan' end;
    v_msg := case
      when v_reason = 'trial_ended' and v_owner then
        'Your free trial has ended, so nothing new can be saved. Choose a plan on Plans & billing to carry on.'
      when v_reason = 'trial_ended' then
        'The free trial for this business has ended, so nothing new can be saved. Ask the owner to choose a plan.'
      when v_reason = 'payment_failed' and v_owner then
        'Your last payment did not go through, so nothing new can be saved. Update your card or choose a plan on Plans & billing to carry on.'
      when v_reason = 'payment_failed' then
        'The last payment for this business did not go through, so nothing new can be saved. Ask the owner to update the card.'
      when v_reason = 'subscription_ended' and v_owner then
        'Your plan has ended, so nothing new can be saved. Choose a plan on Plans & billing to carry on.'
      when v_reason = 'subscription_ended' then
        'The plan for this business has ended, so nothing new can be saved. Ask the owner to choose a plan.'
      when v_owner then
        'This business has no plan yet, so nothing new can be saved. Choose a plan on Plans & billing.'
      else
        'This business has no plan yet, so nothing new can be saved. Ask the owner to choose a plan.'
    end;
    v_msg := v_msg || case when p_needs_sales
                           then ' Payments on sales already confirmed can still be recorded.'
                           else '' end
                   || ' Everything already entered is still here.';
    raise exception '%', v_msg using errcode = 'MMENT', hint = v_reason;
  end if;

  if p_needs_sales and not fn_account_has_sales(p_account_id) then
    raise exception '%', case when v_owner
      then 'Your plan covers costing only, so sales cannot be recorded or changed. '
           'Choose Costing + Sales on Plans & billing to record sales. '
           'Payments on sales already confirmed can still be recorded.'
      else 'The plan for this business covers costing only, so sales cannot be recorded or changed. '
           'Ask the owner about Costing + Sales. '
           'Payments on sales already confirmed can still be recorded.'
      end
      using errcode = 'MMSAL', hint = 'no_sales';
  end if;
end;
$fn$;

comment on function fn_require_entitled(uuid, boolean) is
  'The trial and plan gate of every elevated write function (0066). No-op in '
  'service context. 42501 for a non-member, MMENT when the account has no '
  'access, MMSAL when Sales is needed and the plan lacks it. The message is '
  'plain English for the person; HINT is the reason code (trial_ended, '
  'payment_failed, subscription_ended, no_plan, no_sales). Granted to nobody.';

revoke all on function fn_require_entitled(uuid, boolean) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The 13 elevated write functions, each with its gate after its role check
--    (bodies copied from the 0064 definitions; one line added in each)
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
  perform fn_require_entitled(v_p.account_id);  -- 0066 trial gate

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
  perform fn_require_entitled(v_o.account_id);  -- 0066 trial gate

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
  perform fn_require_entitled(v_p.account_id);  -- 0066 trial gate

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
  perform fn_require_entitled(v_account);  -- 0066 trial gate

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
  perform fn_require_entitled(v_acct);  -- 0066 trial gate

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
  perform fn_require_entitled(r.account_id);  -- 0066 trial gate

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
  perform fn_require_entitled(v.account_id);  -- 0066 trial gate

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
  perform fn_require_entitled(p_account_id);  -- 0066 trial gate

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
  perform fn_require_entitled(v_o.account_id, true);  -- 0066 trial gate

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
  perform fn_require_entitled(o.account_id, true)  -- 0066 trial gate
     from orders o
    where o.id = p_order_id
      and fn_has_account_role(o.account_id, array['owner','manager','sales']::member_role[]);
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
  perform fn_require_entitled(v_o.account_id, true);  -- 0066 trial gate

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
  perform fn_require_entitled(v_o.account_id, true);  -- 0066 trial gate

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
  perform fn_require_entitled(v_e.account_id, true);  -- 0066 trial gate

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

-- ---------------------------------------------------------------------------
-- 4. Money received on a confirmed sale (D2)
-- ---------------------------------------------------------------------------
-- A narrow function instead of loosening p_orders_update: that policy governs
-- the whole row. This changes two columns, on confirmed sales only -- the same
-- two fn_guard_finalised_order already lets move on a confirmed sale.
--
-- Its own refusals carry SQLSTATE MMPAY and a sentence written for the person,
-- which the app shows as it is. The role refusal is fn_require_account_role's
-- 42501, unchanged, which the app words itself ("Your role can't record
-- payments ...").
create function fn_record_order_payment(p_order_id uuid, p_amount_paid numeric,
                                        p_payment_status payment_status)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_o orders%rowtype;
begin
  select * into v_o from orders where id = p_order_id for update;
  if not found then
    raise exception 'This sale could not be found. It may have been removed.'
      using errcode = 'MMPAY';
  end if;

  perform fn_require_account_role(v_o.account_id,
    array['owner','manager','sales']::member_role[], 'recording payments');

  -- Deliberately no trial or plan gate: this is money for work already done
  -- and confirmed, and it is recorded whatever the plan or the trial.
  if v_o.voided_at is not null then
    raise exception 'This sale was cancelled, so no payment can be recorded on it.'
      using errcode = 'MMPAY';
  end if;
  if v_o.finalised_at is null then
    raise exception 'This sale is still a draft. A payment can be recorded once it is confirmed.'
      using errcode = 'MMPAY';
  end if;
  if p_amount_paid is null or p_amount_paid < 0 then
    raise exception 'The amount paid must be zero or more.'
      using errcode = 'MMPAY';
  end if;
  if round(p_amount_paid, 2) >= 1000000000000 then  -- orders.amount_paid is numeric(14,2)
    raise exception 'That amount is too large to record. Check the figure and try again.'
      using errcode = 'MMPAY';
  end if;
  if p_payment_status is null then
    raise exception 'Say whether the sale is not paid, part paid or paid in full.'
      using errcode = 'MMPAY';
  end if;

  update orders
     set amount_paid = p_amount_paid, payment_status = p_payment_status
   where id = p_order_id;
end;
$fn$;

comment on function fn_record_order_payment(uuid, numeric, payment_status) is
  'Records money received on a confirmed, not cancelled sale: amount_paid and '
  'payment_status only. Owner, manager or sales. Works after a trial and on '
  'the Costing plan (owner decision D2, 0066); drafts are refused. Its own '
  'refusals are SQLSTATE MMPAY with a plain sentence; a role refusal is 42501.';

revoke all on function fn_record_order_payment(uuid, numeric, payment_status) from public, anon;
grant execute on function fn_record_order_payment(uuid, numeric, payment_status) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Onboarding, and the trial the subscription guard accepts (D1, D4)
-- ---------------------------------------------------------------------------
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
  v_trial_end timestamptz;                                         -- 0066
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

  -- ---- 0066: a free trial is 14 days ----------------------------------
  -- Refused, not ignored: a client that asks for anything else is broken or
  -- probing, and silently giving it 14 days would hide that. After the replay
  -- above, so a retried onboarding still gets its stored answer. The operator
  -- (service context) keeps the parameter.
  if not fn_is_service_context() and p_trial_days is distinct from 14 then
    raise exception 'A free trial is 14 days. It cannot be changed when signing up.'
      using errcode = '22023';
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

  -- ---- 0066: one business per login, and none on a closed account -----
  -- A login that owns no account but is already staff on one starts no
  -- account of its own: the app and checkout serve one account per login.
  -- An owner adding a business needs their account to have access. The
  -- operator (service context) is not limited.
  if v_account is null then
    if not fn_is_service_context()
       and exists (select 1 from memberships m where m.user_id = v_user) then
      raise exception 'This login already belongs to a business on Menu Master. '
                      'To run a business of your own, sign up with a different email address.'
        using errcode = 'MMLGN';
    end if;
  else
    perform fn_require_entitled(v_account);  -- 0066 trial gate
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
      -- 0066: the trial goes in BEFORE the starter catalogue, which now asks
      -- fn_require_entitled. It ends at 23:59:59 Lagos time on the 14th day;
      -- only the operator may give another length.
      v_trial_end := case when fn_is_service_context() and p_trial_days is distinct from 14
                          then now() + (p_trial_days || ' days')::interval
                          else fn_trial_end(now()) end;
      insert into subscriptions (account_id, plan_id, status,
                                 trial_ends_at, current_period_end)
      values (v_account, p_plan_id, 'trialing', v_trial_end, v_trial_end);

      v_cloned := fn_clone_starter_catalog(v_account, p_business_type);
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

  -- 0066: a trial made without billing is the advertised one. It ends at
  -- 23:59:59 Lagos time on the 14th day (fn_trial_end), and both dates agree.
  if new.current_period_end is distinct from fn_trial_end(now())
     or new.trial_ends_at is distinct from new.current_period_end then
    raise exception 'A free trial ends at the end of its 14th day. It cannot be set to any other date.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. One account per login, the same one everywhere
-- ---------------------------------------------------------------------------
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
  order by m.created_at, m.account_id  -- 0066: the oldest membership, as fn_my_has_sales and the app pick
  limit 1;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Custom units (D7). Same name, same command, same role: the count stays.
-- ---------------------------------------------------------------------------
-- Owner, manager and kitchen: the roles p_ingredients_insert/_update admit. A
-- unit's conversion factor feeds every cost measured in it. Still scoped to
-- authenticated (0018), so a logged-out read never evaluates a member check.
drop policy p_units_write on units;
create policy p_units_write on units
  for all to authenticated
  using      (account_id is not null and fn_is_account_member(account_id)
              and fn_has_account_role(account_id, array['owner','manager','kitchen']::member_role[])
              and fn_account_is_entitled(account_id))
  with check (account_id is not null and fn_is_account_member(account_id)
              and fn_has_account_role(account_id, array['owner','manager','kitchen']::member_role[])
              and fn_account_is_entitled(account_id));

-- ---------------------------------------------------------------------------
-- 8. Live trials move to the end of their last Lagos day (D1)
-- ---------------------------------------------------------------------------
-- Only 'trialing' rows that still have access, and only ever LATER (a row
-- already in the last second of its day is left alone). trial_ends_at moves
-- with current_period_end where the two agreed; where they did not (a hand
-- edit), it is left as it is and POST_VERIFY counts it. Runs as the operator,
-- so the subscription guard lets it through. One history row per trial moved.
create temp table _mm0066_moved (id uuid, account_id uuid, old_end timestamptz, old_trial timestamptz,
                            current_period_end timestamptz, trial_ends_at timestamptz) on commit drop;
with moved as (
  update subscriptions s
     set current_period_end = c.new_end,
         trial_ends_at = case when s.trial_ends_at = s.current_period_end
                              then c.new_end else s.trial_ends_at end
    from (select id, current_period_end as old_end, trial_ends_at as old_trial,
                 ((current_period_end at time zone 'Africa/Lagos')::date + time '23:59:59')
                   at time zone 'Africa/Lagos' as new_end
            from subscriptions
           where status = 'trialing' and current_period_end > now()) c
   where s.id = c.id and c.new_end > s.current_period_end
  returning s.id, s.account_id, c.old_end, c.old_trial, s.current_period_end, s.trial_ends_at
)
insert into _mm0066_moved select * from moved;

insert into subscription_changes
  (subscription_id, account_id, change_kind, previous_values, new_values,
   change_source, authorised_by, reason)
select m.id, m.account_id, 'trial_extended',
       jsonb_build_object('current_period_end', m.old_end)
         || case when m.trial_ends_at is distinct from m.old_trial
                 then jsonb_build_object('trial_ends_at', m.old_trial) else '{}'::jsonb end,
       jsonb_build_object('current_period_end', m.current_period_end)
         || case when m.trial_ends_at is distinct from m.old_trial
                 then jsonb_build_object('trial_ends_at', m.trial_ends_at) else '{}'::jsonb end,
       'owner', 'Owner decision D1, trial plan of 18 Oct 2026',
       '0066: a trial now ends at 23:59:59 Lagos time on its last day, not at the minute setup finished. Moved later only.'
  from _mm0066_moved m;

-- ---------------------------------------------------------------------------
-- 9. Self-check
-- ---------------------------------------------------------------------------
create temp table _mm0066_inserted (sig text primary key, removals text[] not null) on commit drop;
insert into _mm0066_inserted values
  ('public.fn_post_purchase(uuid)', array[$r$
  perform fn_require_entitled(v_p.account_id);  -- 0066 trial gate$r$]),
  ('public.fn_correct_purchase(uuid,date,uuid,text,text,jsonb)', array[$r$
  perform fn_require_entitled(v_o.account_id);  -- 0066 trial gate$r$]),
  ('public.fn_reverse_purchase(uuid,text)', array[$r$
  perform fn_require_entitled(v_p.account_id);  -- 0066 trial gate$r$]),
  ('public.fn_recompute_business_recipes(uuid)', array[$r$
  perform fn_require_entitled(v_account);  -- 0066 trial gate$r$]),
  ('public.fn_recompute_recipes_for_ingredient(uuid,date)', array[$r$
  perform fn_require_entitled(v_acct);  -- 0066 trial gate$r$]),
  ('public.fn_compute_recipe_cost_snapshot(uuid,date,uuid)', array[$r$
  perform fn_require_entitled(r.account_id);  -- 0066 trial gate$r$]),
  ('public.fn_compute_variant_cost_snapshot(uuid,date)', array[$r$
  perform fn_require_entitled(v.account_id);  -- 0066 trial gate$r$]),
  ('public.fn_clone_starter_catalog(uuid,business_type)', array[$r$
  perform fn_require_entitled(p_account_id);  -- 0066 trial gate$r$]),
  ('public.fn_confirm_order(uuid)', array[$r$
  perform fn_require_entitled(v_o.account_id, true);  -- 0066 trial gate$r$]),
  ('public.fn_finalise_order(uuid)', array[$r$
  perform fn_require_entitled(o.account_id, true)  -- 0066 trial gate
     from orders o
    where o.id = p_order_id
      and fn_has_account_role(o.account_id, array['owner','manager','sales']::member_role[]);$r$]),
  ('public.fn_reissue_order(uuid)', array[$r$
  perform fn_require_entitled(v_o.account_id, true);  -- 0066 trial gate$r$]),
  ('public.fn_void_order(uuid,text)', array[$r$
  perform fn_require_entitled(v_o.account_id, true);  -- 0066 trial gate$r$]),
  ('public.fn_void_sales_entry(uuid,text)', array[$r$
  perform fn_require_entitled(v_e.account_id, true);  -- 0066 trial gate$r$]),
  ('public.fn_guard_subscription_writes()', array[$r$
  -- 0066: a trial made without billing is the advertised one. It ends at
  -- 23:59:59 Lagos time on the 14th day (fn_trial_end), and both dates agree.
  if new.current_period_end is distinct from fn_trial_end(now())
     or new.trial_ends_at is distinct from new.current_period_end then
    raise exception 'A free trial ends at the end of its 14th day. It cannot be set to any other date.'
      using errcode = '42501';
  end if;
$r$]),
  ('public.fn_my_entitlement_status()', array[$r$
  order by m.created_at, m.account_id  -- 0066: the oldest membership, as fn_my_has_sales and the app pick$r$]);

do $$
declare
  r record; v_bad text := ''; v_def text; v_n int; v_moved int; v_logged int;
  v_te oid := to_regprocedure('public.fn_trial_end(timestamptz)');
  v_re oid := to_regprocedure('public.fn_require_entitled(uuid, boolean)');
  v_rp oid := to_regprocedure('public.fn_record_order_payment(uuid, numeric, public.payment_status)');
  v_onb text := pg_get_functiondef(to_regprocedure(
    'public.fn_create_account_and_business(text,text,business_type,uuid,text,text,integer,text,uuid)'));
begin
  -- the three new functions
  if v_te is null or v_re is null or v_rp is null then
    raise exception '0066 self-check FAILED: a new function is missing.';
  end if;
  if (select prosecdef or provolatile <> 's' from pg_proc where oid = v_te)
     or (select prosecdef or provolatile <> 's' from pg_proc where oid = v_re)
     or not (select prosecdef and provolatile = 'v' from pg_proc where oid = v_rp) then
    raise exception '0066 self-check FAILED: fn_trial_end and fn_require_entitled must be STABLE invoker, '
                    'fn_record_order_payment a VOLATILE definer.';
  end if;
  if exists (select 1 from pg_proc p where p.oid in (v_te, v_re, v_rp)
               and not exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public')) then
    raise exception '0066 self-check FAILED: a new function does not pin search_path to public.';
  end if;
  if exists (select 1 from pg_proc p, unnest(p.proacl) a where p.oid in (v_te, v_re, v_rp) and a::text like '=%')
     or has_function_privilege('anon', v_te, 'execute') or has_function_privilege('anon', v_rp, 'execute')
     or has_function_privilege('anon', v_re, 'execute') then
    raise exception '0066 self-check FAILED: a new function is executable by PUBLIC or by a logged-out caller.';
  end if;
  if has_function_privilege('authenticated', v_re, 'execute')
     or has_function_privilege('service_role', v_re, 'execute') then
    raise exception '0066 self-check FAILED: fn_require_entitled must be granted to nobody.';
  end if;
  if not has_function_privilege('authenticated', v_rp, 'execute') then
    raise exception '0066 self-check FAILED: a signed-in user cannot call fn_record_order_payment.';
  end if;
  if (select position('MMPAY' in prosrc) = 0 or prosrc ~ 'check_violation' from pg_proc where oid = v_rp) then
    raise exception '0066 self-check FAILED: fn_record_order_payment must raise its own refusals as MMPAY.';
  end if;

  -- D1: 23:59:59 Lagos on the 14th Lagos day, wherever in the day it starts
  if fn_trial_end('2026-10-18 09:30:00+01') <> '2026-11-01 23:59:59+01'
     or fn_trial_end('2026-10-18 23:30:00+01') <> '2026-11-01 23:59:59+01'
     or fn_trial_end('2026-10-17 23:10:00+00') <> '2026-11-01 23:59:59+01'   -- 00:10 on the 18th in Lagos
     or fn_trial_end('2026-10-18 22:59:59+00') <> '2026-11-01 23:59:59+01'
     or fn_trial_end(null) is not null then
    raise exception '0066 self-check FAILED: fn_trial_end does not give 23:59:59 Lagos on the 14th day.';
  end if;

  -- every copied body is its 0064 definition plus only the added lines
  for r in select i.sig, i.removals, e.md5_0064
             from _mm0066_inserted i join _mm0066_expected e using (sig) loop
    v_def := pg_get_functiondef(to_regprocedure(r.sig));
    for v_n in 1 .. array_length(r.removals, 1) loop
      if position(r.removals[v_n] in v_def) = 0 then
        v_bad := v_bad || E'\n  ' || r.sig || ': the 0066 line is missing';
      end if;
      v_def := replace(v_def, r.removals[v_n], '');
    end loop;
    if md5(v_def) <> r.md5_0064 then
      v_bad := v_bad || E'\n  ' || r.sig || ': differs from 0064 by more than the 0066 line';
    end if;
  end loop;
  if v_bad <> '' then
    raise exception '0066 self-check FAILED:%', v_bad;
  end if;
  if (select count(*) from _mm0066_inserted) <> 15 then
    raise exception '0066 self-check FAILED: % functions checked line by line, expected 15.',
      (select count(*) from _mm0066_inserted);
  end if;

  -- onboarding: the three refusals, the Lagos trial end, trial before catalogue
  if position('fn_trial_end(now())' in v_onb) = 0
     or position('MMLGN' in v_onb) = 0
     or position('p_trial_days is distinct from 14' in v_onb) = 0
     or position('perform fn_require_entitled(v_account);' in v_onb) = 0
     or position('insert into subscriptions' in v_onb) > position('v_cloned := fn_clone_starter_catalog' in v_onb)
     or position('-- ---- replay' in v_onb) > position('p_trial_days is distinct from 14' in v_onb) then
    raise exception '0066 self-check FAILED: fn_create_account_and_business is not the 0066 onboarding.';
  end if;

  -- member management is still open
  select string_agg(p.proname, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('fn_invite_member','fn_accept_invitations','fn_set_member_role',
                       'fn_remove_member','fn_revoke_invitation','fn_record_order_payment')
     and p.prosrc ~ 'perform\s+fn_require_entitled\(';
  if v_bad is not null then
    raise exception '0066 self-check FAILED: % must stay open after a trial.', v_bad;
  end if;

  -- THE CATALOGUE RULE: every elevated, volatile fn_* a signed-in user can run
  -- either asks fn_require_entitled or is on the open list on purpose.
  --   member management (0028: an owner is never locked out of their people)
  --   fn_record_order_payment (D2: money owed on confirmed sales)
  --   platform administration (checks fn_require_platform_admin; no account)
  --   onboarding (its first-account branch is open; the rest is gated)
  -- Stable and immutable functions only read, so they are outside the rule.
  select string_agg(p.oid::regprocedure::text, ', ' order by p.proname) into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname like 'fn\_%'
     and p.prosecdef and p.provolatile = 'v'
     and p.prorettype <> 'trigger'::regtype
     and has_function_privilege('authenticated', p.oid, 'execute')
     and p.prosrc !~ 'perform\s+fn_require_entitled\('
     and p.proname not in ('fn_invite_member','fn_accept_invitations','fn_set_member_role',
                           'fn_remove_member','fn_revoke_invitation',
                           'fn_record_order_payment',
                           'fn_admin_resolve_alert','fn_admin_set_site_setting','fn_admin_scan',
                           'fn_create_account_and_business');
  if v_bad is not null then
    raise exception '0066 self-check FAILED: these elevated write functions neither ask fn_require_entitled '
                    'nor are on the open list: %', v_bad;
  end if;

  -- units (D7)
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='units' and policyname='p_units_write'
                    and cmd='ALL' and roles='{authenticated}'
                    and qual like '%fn_account_is_entitled(account_id)%'
                    and with_check like '%fn_account_is_entitled(account_id)%'
                    and with_check like '%''owner''::member_role, ''manager''::member_role, ''kitchen''::member_role%') then
    raise exception '0066 self-check FAILED: p_units_write is not the 0066 policy.';
  end if;

  -- D1 backfill: every live trial ends in the last second of a Lagos day,
  -- and every moved trial has its one history row
  select count(*) into v_n from subscriptions
   where status = 'trialing' and current_period_end > now()
     and to_char(current_period_end at time zone 'Africa/Lagos', 'HH24:MI:SS') <> '23:59:59';
  if v_n > 0 then
    raise exception '0066 self-check FAILED: % live trial(s) do not end at 23:59:59 Lagos time.', v_n;
  end if;
  select count(*) into v_moved from _mm0066_moved;
  select count(*) into v_logged from subscription_changes
   where change_kind = 'trial_extended' and reason like '0066:%'
     and subscription_id in (select id from _mm0066_moved);
  if v_logged <> v_moved then
    raise exception '0066 self-check FAILED: % trial(s) moved but % history row(s) written.', v_moved, v_logged;
  end if;

  if (select count(*) from pg_policies where schemaname='public') <> 118 then
    raise exception '0066 self-check FAILED: policy count is %, expected 118.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 102 then
    raise exception '0066 self-check FAILED: fn_* count is %, expected 102.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;

  raise notice '0066 OK: 13 elevated write functions ask fn_require_entitled; fn_record_order_payment '
               'records money on confirmed sales; onboarding fixed at 14 days, one account per login; '
               'trials end 23:59:59 Lagos (% live trial(s) moved later, each logged); units limited to '
               'owner, manager and kitchen with access; 118 policies, 102 fn_*.', v_moved;
end
$$;
