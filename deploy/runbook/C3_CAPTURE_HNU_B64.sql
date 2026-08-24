-- ============================================================================
-- MENU MASTER NG — transport-safe capture of handle_new_user's definition
--
--   *** PURE SELECT. Single statement. No state change. ***
--
-- WHY THIS EXISTS
--   The 0019c preflight returned both the definition text and its md5. The
--   md5 was 6eccc287be2c1bb645b28fbe8ccbe644, but the text as it arrived
--   hashes to 8307129d29688653048443f42b2c9eb5. Line-ending and trailing-
--   newline variants were all tested and none reconcile them, so the CSV
--   export altered the text somewhere. The md5 is computed inside the database
--   and is therefore authoritative; the rendered text is not.
--
--   A byte-exact rollback cannot be written from text that is demonstrably
--   mangled in transit. Base64 is transport-safe -- it survives CSV quoting,
--   line-ending conversion and copy-paste unchanged -- and it can be verified
--   against the md5 already captured.
--
-- WHAT TO DO
--   Run this and return all four rows verbatim. Row 2 is a single unbroken
--   line with no spaces; copy it whole.
-- ============================================================================

select * from (

  select '1 fingerprint' as section,
         'md5 of pg_get_functiondef (must equal the preflight value)' as item,
         coalesce((select md5(pg_get_functiondef(p.oid)) from pg_proc p
                    where p.pronamespace='public'::regnamespace
                      and p.proname='handle_new_user'), 'ABSENT') as value

  union all
  select '2 payload',
         'base64 of the definition, single line -- COPY WHOLE',
         coalesce((select replace(
                            encode(convert_to(pg_get_functiondef(p.oid), 'UTF8'), 'base64'),
                            chr(10), '')
                     from pg_proc p
                    where p.pronamespace='public'::regnamespace
                      and p.proname='handle_new_user'), 'ABSENT')

  union all
  select '3 integrity',
         'byte length of the definition',
         coalesce((select octet_length(convert_to(pg_get_functiondef(p.oid), 'UTF8'))::text
                     from pg_proc p
                    where p.pronamespace='public'::regnamespace
                      and p.proname='handle_new_user'), 'ABSENT')

  union all
  -- Any existing COMMENT must be restored by the rollback too, so capture it.
  select '4 comment',
         'existing COMMENT on the function (restored on rollback)',
         coalesce((select obj_description(p.oid, 'pg_proc') from pg_proc p
                    where p.pronamespace='public'::regnamespace
                      and p.proname='handle_new_user'), '(none)')

) as t order by 1;
