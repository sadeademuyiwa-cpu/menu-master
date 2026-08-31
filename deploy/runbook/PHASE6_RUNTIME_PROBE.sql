-- ============================================================================
-- SUPERSEDED -- DO NOT RUN
--
-- An earlier six-migration-era probe. It writes and relies on a closing
-- rollback; to undo itself, and it carries none of the warnings the current
-- probe does about executors that ignore transaction control -- which is
-- exactly what the Supabase SQL Editor did on 2026-08-31.
--
-- Use deploy/runbook/RUNTIME_PROBE.sql, and read its banner first: it must be
-- run through psql on a single connection, never through the SQL Editor.
-- ============================================================================
do $$
begin
  raise exception 'PHASE6_RUNTIME_PROBE.sql is superseded. Use deploy/runbook/RUNTIME_PROBE.sql, via psql only.';
end
$$;
