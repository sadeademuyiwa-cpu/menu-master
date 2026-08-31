-- ============================================================================
-- DIAGNOSE_FINGERPRINT.sql          READ ONLY -- this query changes nothing.
--
-- Why PRE_DEPLOY_AUDIT check 1 failed closed on 2026-08-31.
--
-- The first fingerprint was built from oid::regprocedure and ordered by the
-- DATABASE's own collation. Both of those vary between databases holding an
-- IDENTICAL set of functions:
--
--   * regprocedure schema-qualifies type names according to search_path;
--   * ORDER BY on text follows the database collation, and a name like
--     'fn__recipe_cost_core' sorts 1st under "C" but 42nd under a locale that
--     folds underscores.
--
-- The rehearsal replica is C.UTF-8. Supabase projects are created en_US.UTF-8.
-- Same 60 functions, different sort order, different md5.
--
-- This query returns, in ONE result set:
--   line 1   the database collation
--   line 2   the STABLE fingerprint (bare type names, ordered COLLATE "C")
--   line 3   the OLD fingerprint recomputed under COLLATE "C"
--   line 4   the OLD fingerprint recomputed under an ICU/en_US ordering
--   line 5+  every fn_* signature, so the two catalogues can be compared
--            directly rather than trusted.
--
-- Paste the whole file into the Supabase SQL Editor and press Run.
-- ============================================================================
with s as (
  select replace(p.oid::regprocedure::text, ' ', '') as old_sig,
         p.proname || '(' || coalesce((
           select string_agg(t.typname, ',' order by u.ord)
             from unnest(p.proargtypes) with ordinality as u(oid, ord)
             join pg_type t on t.oid = u.oid), '') || ')' as sig
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname like 'fn\_%'
)
select 1 as line, 'database collation' as item,
       datcollate || ' / ' || datctype as value
  from pg_database where datname = current_database()
union all
select 2, 'STABLE fingerprint (expect 0566a47b992936813893b40bcba5c6ac at 0033)',
       md5(string_agg(sig, ',' order by sig collate "C")) || '   [' || count(*) || ' functions]'
  from s
union all
select 3, 'OLD fingerprint recomputed COLLATE "C"',
       md5(string_agg(old_sig, ',' order by old_sig collate "C")) from s
union all
select 4, 'OLD fingerprint recomputed COLLATE "en-US-x-icu"',
       md5(string_agg(old_sig, ',' order by old_sig collate "en-US-x-icu")) from s
union all
select 4 + row_number() over (order by sig collate "C"), 'signature', sig from s
order by 1;
