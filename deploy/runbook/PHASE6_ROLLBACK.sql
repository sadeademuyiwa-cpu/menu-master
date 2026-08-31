-- ============================================================================
-- PHASE 6 -- EMERGENCY ROLLBACK
--
-- Only needed if STEP 2 COMMITTED and STEP 3 then found a problem. If STEP 2
-- failed, it rolled itself back and there is nothing to undo -- confirm with
-- STEP 3 and stop.
--
-- Reverse order, 0048 first. Each rollback file carries its own begin/commit,
-- so run them ONE AT A TIME and check the NOTICE before moving to the next.
--
-- WHAT THIS DOES NOT UNDO, deliberately:
--
--   Lines frozen at confirmation after the deploy stay frozen. Those are
--     confirmed sales; un-freezing them would destroy real economics.
--   The finalised_at values 0045 recorded on legacy orders stay. Blanking them
--     would mean guessing which rows were reconciled and which were genuinely
--     finalised, and guessing wrong would unlock a real sale. Harmless: the
--     pre-0045 reporting keys on status, not finalised_at, so no figure moves.
--   Discounts and customer notes entered after the deploy are lost with their
--     columns. Capture them first if the window was long enough to matter.
--
-- Rolling back 0047 restores two known defects: drafts counted as revenue, and
-- gross profit crediting uncosted revenue as pure profit. Go forward again
-- quickly.
-- ============================================================================
\echo 'Run these ONE AT A TIME, checking the NOTICE after each:'
\echo '  \i migrations/proposed/0048_rollback.sql'
\echo '  \i migrations/proposed/0047_rollback.sql'
\echo '  \i migrations/proposed/0046_rollback.sql'
\echo '  \i migrations/proposed/0045_rollback.sql'
\echo '  \i migrations/proposed/0044_rollback.sql'
\echo '  \i migrations/proposed/0043_rollback.sql'
\echo ''
\echo 'Then re-run STEP 1 (PHASE6_PRE_BASELINE.sql) and confirm the financial'
\echo 'totals match what you captured before the deploy.'
