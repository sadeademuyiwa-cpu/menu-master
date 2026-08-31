-- ============================================================================
-- DIAGNOSE_FINGERPRINT.sql        READ ONLY -- this query changes nothing.
--                                 It is a SELECT. It creates, alters and drops
--                                 nothing, and it does not touch auth.users.
--
-- Why PRE_DEPLOY_AUDIT check 1 failed closed on 2026-08-31.
--
-- The first fingerprint was built from oid::regprocedure and sorted using the
-- DATABASE's own collation. Both of those vary between two databases holding an
-- IDENTICAL set of functions:
--
--   * regprocedure schema-qualifies type names according to search_path;
--   * ORDER BY on text follows the database collation, and a name like
--     'fn__recipe_cost_core' sorts 1st under "C" but 42nd under a locale that
--     folds underscores.
--
-- The rehearsal replica is C.UTF-8. Supabase creates projects en_US.UTF-8.
-- Same 60 functions, different sort order, different md5.
--
-- Reads, in ONE result set:
--   line 1   this database's collation
--   line 2   the STABLE fingerprint -- bare type names, sorted COLLATE "C", so
--            it depends on neither the collation nor search_path.
--            THIS IS THE DECIDING LINE.
--   line 3   the ORIGINAL fingerprint recomputed with the sort order pinned to
--            COLLATE "C". If this reads 26a45d7d98026721366ec58a66cb6d1b -- the
--            value the failed gate expected -- then the catalogue was never
--            different and collation was the whole story.
--   line 4   a plain-English verdict, so no hex has to be compared by eye.
--   line 5+  every fn_* signature, for a direct catalogue comparison.
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
),
fp as (
  select md5(string_agg(sig,     ',' order by sig     collate "C")) as stable_fp,
         md5(string_agg(old_sig, ',' order by old_sig collate "C")) as old_fp_c,
         count(*) as n
    from s
)
select 1 as line, 'this database collation' as item,
       datcollate || ' / ' || datctype as value
  from pg_database where datname = current_database()
union all
select 2, 'STABLE fingerprint  (expect 0566a47b992936813893b40bcba5c6ac)',
       stable_fp || '   [' || n || ' functions, expect 60]' from fp
union all
select 3, 'ORIGINAL fingerprint, sort pinned COLLATE "C"  (expect 26a45d7d98026721366ec58a66cb6d1b)',
       old_fp_c from fp
union all
select 4, 'VERDICT',
       case when stable_fp = '0566a47b992936813893b40bcba5c6ac' and n = 60
            then 'MATCH -- this catalogue is exactly the rehearsed 0033 set. Proceed to PRE_DEPLOY_AUDIT.'
            else 'MISMATCH -- STOP. Do not deploy. Send lines 1-3 and the signature list back.'
       end from fp
union all
select 4 + row_number() over (order by sig collate "C"), 'signature', sig from s
order by 1;
