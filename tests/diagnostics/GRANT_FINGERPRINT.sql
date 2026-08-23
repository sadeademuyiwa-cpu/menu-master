-- ============================================================================
-- MENU MASTER NG — grant-surface fingerprint
--
-- DISPOSABLE PROJECT ONLY. READ ONLY: one SELECT.
--
-- Reduces the entire client-role privilege surface to one short hash, plus
-- the counts behind it. Run before and after re-applying 0018: an idempotent
-- migration must leave the fingerprint byte-identical.
-- ============================================================================

select
  substr(md5(string_agg(grantee||'.'||table_name||'.'||privilege_type, '|'
                        order by grantee, table_name, privilege_type)), 1, 12)
                                                              as fingerprint,
  count(*)                                                    as total_grants,
  count(*) filter (where grantee = 'anon')                    as anon_grants,
  count(*) filter (where grantee = 'authenticated')           as authenticated_grants,
  count(*) filter (where privilege_type in
                   ('TRUNCATE','TRIGGER','REFERENCES'))       as ungated_privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon','authenticated');
