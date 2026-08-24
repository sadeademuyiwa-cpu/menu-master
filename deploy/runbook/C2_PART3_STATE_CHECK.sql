-- ============================================================================
-- MENU MASTER NG — Part 3 state proof
--
--   *** PURE SELECT. Single statement. No state change. ***
--
-- Run after the Part 3 duplicate-key error, to prove whether 0003 is fully
-- applied or not applied.
--
-- PRECONDITION: catalog_categories and catalog_ingredients are created by
-- 0003, so this script fails at PARSE time if 0003 never ran at all. That
-- parse error is itself the answer -- it means 0003 is absent, and no
-- duplicate-key error could have come from it. The unique index on
-- (coalesce(account_id, zero-uuid), lower(code)) makes duplicate unit codes
-- structurally impossible, so a correct count is proof of a clean single
-- application -- not merely consistent with one.
-- ============================================================================

select * from (
  select '1 units'    as check, 'total rows'              as item, count(*)::text as observed,
         case when count(*) = 45 then 'OK — exactly one full application'
              when count(*) = 0  then '>>> 0003 NOT APPLIED'
              else '>>> UNEXPECTED COUNT' end as verdict
    from units
  union all
  select '1 units', 'distinct lower(code)', count(distinct lower(code))::text,
         case when count(distinct lower(code)) = count(*) then 'OK — no duplicates possible'
              else '>>> DUPLICATES PRESENT' end
    from units
  union all
  select '1 units', 'global (account_id is null)', count(*)::text,
         case when count(*) = 45 then 'OK — all 45 are global reference units'
              else '>>> UNEXPECTED' end
    from units where account_id is null
  union all
  select '1 units', 'by kind', string_agg(k || '=' || n, ' ' order by k),
         'expect container=33 count=3 mass=3 volume=6'
    from (select kind::text as k, count(*)::text as n from units group by kind) z
  union all
  select '2 catalogue', 'catalog_categories', count(*)::text,
         case when count(*) = 16 then 'OK' else '>>> EXPECTED 16' end
    from catalog_categories
  union all
  select '2 catalogue', 'catalog_ingredients', count(*)::text,
         case when count(*) = 180 then 'OK' else '>>> EXPECTED 180' end
    from catalog_ingredients
  union all
  select '3 not yet seeded', 'plans', count(*)::text,
         case when count(*) = 0 then 'OK — 0010 seeds these in PART_4' else '>>> UNEXPECTED' end
    from plans
  union all
  select '3 not yet seeded', 'plan_features', count(*)::text,
         case when count(*) = 0 then 'OK — 0010 seeds these in PART_4' else '>>> UNEXPECTED' end
    from plan_features
  union all
  select '4 tenant data', 'all tenant tables', 
         (select count(*) from accounts)::text || '/' || (select count(*) from businesses)::text
           || '/' || (select count(*) from ingredients)::text || '/' || (select count(*) from recipes)::text,
         case when (select count(*) from accounts) = 0 and (select count(*) from businesses) = 0
               and (select count(*) from ingredients) = 0 and (select count(*) from recipes) = 0
              then 'OK — accounts/businesses/ingredients/recipes all empty'
              else '>>> SOMETHING WROTE TENANT DATA' end
) as t order by 1, 2;
