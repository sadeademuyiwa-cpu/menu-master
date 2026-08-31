-- ============================================================================
-- SUPERSEDED -- DO NOT RUN
--
-- This was the rollback for a SIX-migration deployment (0043-0048) applied one
-- file at a time. The deployment scope is now FIFTEEN migrations, 0034-0048,
-- applied as a single transaction, and this file would leave the database in a
-- state neither version understands.
--
-- Use deploy/runbook/ROLLBACK.sql. It undoes 0048 back to 0033 in ONE
-- transaction and asserts the 0033 function fingerprint before it commits.
-- ============================================================================
do $$
begin
  raise exception 'PHASE6_ROLLBACK.sql is superseded. Use deploy/runbook/ROLLBACK.sql.';
end
$$;
