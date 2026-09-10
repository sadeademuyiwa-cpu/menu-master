-- ============================================================================
-- 0024 ROLLBACK -- removes the variant costing functions and the cutover view
--
-- 0024 stored nothing and changed no existing read path: nothing that predates
-- it reads any object it created. Dropping them is therefore a pure removal
-- with no data consequence.
--
-- Do NOT run this once 0025 is applied: Phase 5 repoints the views and
-- fn_freeze_sale_cost onto these functions. The preflight refuses that case.
-- ============================================================================

do $$
begin
  if (select count(*) from pg_proc
       where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 52 then
    raise exception '0024 rollback FAILED: expected 52 fn_* functions, found %. '
                    'If 0025 is applied, reverse that first -- it depends on '
                    'the functions this rollback removes.',
      (select count(*) from pg_proc
        where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
end
$$;

drop view     if exists v_gate2_cutover;
drop function if exists fn_variant_cost(uuid);
drop function if exists fn_variant_problem(uuid);
drop function if exists fn_variant_resolved_qty(uuid);

do $$
declare v_fns int; v_rels int;
begin
  select count(*) into v_fns from pg_proc
   where pronamespace='public'::regnamespace and proname like 'fn\_%';
  select count(*) into v_rels from pg_class
   where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f');
  if v_fns <> 49 or v_rels <> 48 then
    raise exception '0024 rollback self-check FAILED: % / %, expected 49 / 48.',
      v_fns, v_rels;
  end if;
  raise notice '0024 ROLLBACK OK: back to 49 fn_* / 48 relations. The 0023 '
               'overhead basis and all Gate 2 data are untouched.';
end
$$;
