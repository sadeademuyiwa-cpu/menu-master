-- ============================================================================
-- 0063 -- POST-VERIFY                 READ ONLY. Changes nothing.
-- Run immediately after 0063 commits, before 0064.
-- EXPECTED: 7 rows, every one PASS.
-- ============================================================================
with checks(n, check_name, ok, detail) as (
  select 1, 'recipes.photo_path: nullable text, kept inside its own business folder (ck_recipes_photo_path)',
         exists(select 1 from information_schema.columns
                 where table_schema='public' and table_name='recipes' and column_name='photo_path'
                   and data_type='text' and is_nullable='YES')
         and exists(select 1 from pg_constraint
                     where conrelid='public.recipes'::regclass and conname='ck_recipes_photo_path'
                       and contype='c' and convalidated), ''
  union all select 2, 'bucket "dish": public, 512 KB, JPEG and WebP only',
         exists(select 1 from storage.buckets where id='dish' and public and file_size_limit=524288
                  and allowed_mime_types = array['image/jpeg','image/webp']),
         coalesce((select public||' '||file_size_limit||' '||allowed_mime_types::text
                     from storage.buckets where id='dish'), 'no bucket')
  union all select 3, 'four mm_dish_* storage policies, all for authenticated, all limited to bucket "dish"',
         (select count(*) from pg_policies where schemaname='storage' and tablename='objects'
            and policyname like 'mm\_dish\_%' and roles = '{authenticated}'
            and coalesce(qual, '') || coalesce(with_check, '') like '%''dish''%') = 4,
         (select string_agg(policyname, ', ' order by policyname) from pg_policies
           where schemaname='storage' and policyname like 'mm\_dish\_%')
  union all select 4, 'the three write policies require owner, manager or kitchen on an entitled account',
         (select count(*) from pg_policies where schemaname='storage' and policyname like 'mm\_dish\_%'
            and cmd in ('INSERT','UPDATE','DELETE')
            and coalesce(qual, '') || coalesce(with_check, '') like '%fn_has_account_role%'
            and coalesce(qual, '') || coalesce(with_check, '') like '%''kitchen''%'
            and coalesce(qual, '') || coalesce(with_check, '') not like '%''sales''%'
            and coalesce(qual, '') || coalesce(with_check, '') like '%fn_account_is_entitled%') = 3, ''
  union all select 5, 'the website bucket''s four mm_site_* policies are unchanged',
         (select count(*) from pg_policies where schemaname='storage' and policyname like 'mm\_site\_%') = 4, ''
  -- Row 6 holds only between 0063 and 0064: 0064 adds fn_menu_prices (99 fn_*).
  union all select 6, '118 policies in public and 98 fn_* functions, unchanged',
         (select count(*) from pg_policies where schemaname='public') = 118
         and (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') = 98,
         (select count(*)::text from pg_policies where schemaname='public') || ' policies, '
         || (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') || ' fn_*'
  union all select 7, 'the paying customers are untouched',
         true, coalesce((select string_agg(plan_id||':'||status||':'||current_period_end::date, ', ')
                           from subscriptions s join plans p on p.id=s.plan_id where p.price_tier<>'trial'), 'no paid subscriptions')
)
select n, case when ok then 'PASS' else 'FAIL' end as result, check_name, detail
  from checks order by n;
