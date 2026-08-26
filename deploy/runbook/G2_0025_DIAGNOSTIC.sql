-- ============================================================================
-- MENU MASTER NG -- 0025 FAILURE DIAGNOSTIC
--
-- READ ONLY. Pure SELECT. No DDL, no DML, no transaction needed.
--
-- 0025 aborted with 42710: constraint "chk_complete_requires_resolution" for
-- relation "cost_snapshots" already exists. Because 0025 ran inside an explicit
-- transaction, NOTHING was applied -- the whole thing rolled back.
--
-- Only one artefact in the entire chain ever added that constraint: the
-- SUPERSEDED 0021 build, sha256 48a43032..., which added it UNSCOPED:
--     check (not is_complete or resolved_qty is not null)
-- The corrected build b60d1d40... deliberately does not add it at all.
--
-- Row 1 settles which build is live. Read it first.
-- ============================================================================

select * from (

select 1 as n, 'the constraint definition -- THIS IS THE ANSWER' as check,
  coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c
             where c.conname = 'chk_complete_requires_resolution'
               and c.conrelid = 'public.cost_snapshots'::regclass),
           'ABSENT') as observed,
  case
    when not exists (select 1 from pg_constraint c
                      where c.conname='chk_complete_requires_resolution'
                        and c.conrelid='public.cost_snapshots'::regclass)
      then 'ABSENT -- the corrected 0021 is live; 0025 should not have hit 42710'
    when (select pg_get_constraintdef(c.oid) from pg_constraint c
           where c.conname='chk_complete_requires_resolution'
             and c.conrelid='public.cost_snapshots'::regclass) like '%variant_id%'
      then 'SCOPED -- already the 0025 form'
    else 'UNSCOPED -- THE SUPERSEDED 0021 BUILD WAS APPLIED. '
         'This breaks the costing engine on the first complete recipe.'
  end as verdict

union all
select 2, 'transaction rolled back? 0025 objects must be ABSENT',
  (select count(*)::text from pg_proc
    where pronamespace='public'::regnamespace
      and proname='fn_compute_variant_cost_snapshot') || ' (expect 0)',
  case when not exists (select 1 from pg_proc
                         where pronamespace='public'::regnamespace
                           and proname='fn_compute_variant_cost_snapshot')
       then 'GO -- 0025 correctly applied nothing'
       else 'STOP -- 0025 partially applied; do not proceed' end

union all
select 3, 'schema shape (should still be post-0024)',
  (select count(*) from pg_proc where pronamespace='public'::regnamespace
     and proname like 'fn\_%')::text || ' / ' ||
  (select count(*) from pg_class where relnamespace='public'::regnamespace
     and relkind in ('r','p','v','m','f'))::text || ' / ' ||
  (select count(*) from pg_policies where schemaname='public')::text,
  case when (select count(*) from pg_proc where pronamespace='public'::regnamespace
               and proname like 'fn\_%') = 52
        and (select count(*) from pg_class where relnamespace='public'::regnamespace
               and relkind in ('r','p','v','m','f')) = 49
        and (select count(*) from pg_policies where schemaname='public') = 105
       then 'GO -- 52 / 49 / 105 as expected' else 'STOP -- unexpected shape' end

union all
select 4, 'v_price_check column count (20 = not repointed)',
  (select count(*)::text from information_schema.columns
    where table_schema='public' and table_name='v_price_check'),
  case when (select count(*) from information_schema.columns
              where table_schema='public' and table_name='v_price_check') = 20
       then 'GO -- still the pre-0025 view' else 'STOP' end

union all
select 5, 'rows the unscoped constraint would already be blocking',
  (select count(*)::text from cost_snapshots where is_complete and resolved_qty is null),
  case when (select count(*) from cost_snapshots) = 0
       then 'GO -- no snapshots exist yet, so nothing has hit it'
       else 'OPERATOR CHECK -- snapshots exist; read the count' end

union all
select 6, 'tenant data present?',
  (select count(*)::text from accounts) || ' account(s), ' ||
  (select count(*)::text from cost_snapshots) || ' snapshot(s)',
  case when (select count(*) from accounts) = 0
       then 'GO -- the latent defect has not been reachable'
       else 'OPERATOR CHECK' end

union all
select 7, 'the 0021 objects themselves (identical in both builds)',
  (select count(*)::text from pg_class
    where relnamespace='public'::regnamespace and relkind='r'
      and relname in ('serving_formats','recipe_variants',
                      'serving_format_packaging','serving_format_changes')) || ' of 4 tables',
  case when (select count(*) from pg_class
              where relnamespace='public'::regnamespace and relkind='r'
                and relname in ('serving_formats','recipe_variants',
                                'serving_format_packaging','serving_format_changes')) = 4
       then 'GO -- Gate 2 Phase 1 is present either way' else 'STOP' end

) rows order by n;
