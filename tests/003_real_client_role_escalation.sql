-- ============================================================================
-- Test 003: role escalation from a REAL restricted client connection.
-- Connect as `authenticator` (LOGIN, NOINHERIT) — what PostgREST actually is.
-- ============================================================================
\set ON_ERROR_STOP off
select current_user as connected_as, session_user;

\echo '--- 1. normal authenticated client ---'
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select coalesce(current_setting('role',true),'none') as role_guc,
       fn_is_service_context() as claims_service_context;

\echo '--- 2. escalation to postgres (must ERROR) ---'
set role postgres;

\echo '--- 3. escalation to service_role WHILE holding a user JWT (SET may succeed, service context must NOT) ---'
reset role;
set role service_role;
select coalesce(current_setting('role',true),'none') as role_guc,
       coalesce(current_setting('request.jwt.claim.sub',true),'<none>') as jwt_sub,
       fn_is_service_context() as claims_service_context;

\echo '--- 4. genuine service_role call with no user JWT (must be service context) ---'
reset role;
select set_config('request.jwt.claim.sub','',false);
set role service_role;
select coalesce(current_setting('role',true),'none') as role_guc,
       fn_is_service_context() as claims_service_context;
