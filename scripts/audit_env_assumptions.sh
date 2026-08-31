#!/usr/bin/env bash
# Static guard against environment-specific assumptions in the migration bundle.
#
# The second production attempt failed because 0048 asserted
#   has_function_privilege('authenticator', 'local_pre_request()', 'execute')
# and local_pre_request() exists only in tests/0000_local_supabase_shim.sql,
# which the shim itself labels "LOCAL ONLY ... Never run against Supabase".
# has_function_privilege() on a TEXT signature raises 42883 for a function that
# does not exist -- it does not return false -- so the assertion aborted the
# whole transaction on the one database it was supposed to protect.
#
# Every rehearsal database is built by applying that shim first, so the function
# was always present locally and the check always passed. This script fails the
# build if any migration hardcodes a function name into a privilege lookup
# again, or resolves a literal signature in a way that raises rather than
# returning NULL.
#
# Exit 0 = clean. Exit 1 = a finding that must be fixed or explicitly waived.
set -uo pipefail
R="$(cd "$(dirname "$0")/.." && pwd)"
FILES=()
for n in 0034 0035 0036 0037 0038 0039 0040 0041 0042 0043 0044 0045 0046 0047 0048; do
  FILES+=("$(ls "$R"/migrations/proposed/${n}_*.sql | grep -v _rollback | head -1)")
done

# Names the local shim creates that the hosted platform does NOT provide.
SHIM_ONLY=$(grep -oE "create or replace function public\.[a-z_]+" "$R/tests/0000_local_supabase_shim.sql" \
            | sed 's/.*public\.//' | sort -u)

rc=0
say () { echo "  $*"; }

echo "== 1. literal function signatures inside privilege lookups"
hits=$(grep -nE "has_(function|table|schema)_privilege[^;]*'[a-zA-Z_]+\(" "${FILES[@]}" || true)
if [ -n "$hits" ]; then
  # A literal is only safe if it is resolved through to_regprocedure first.
  bad=$(echo "$hits" | grep -v "to_regprocedure" || true)
  if [ -n "$bad" ]; then
    say "FAIL -- a literal signature is passed straight to a privilege lookup."
    say "        has_*_privilege raises 42883 on a missing object; wrap it in"
    say "        to_regprocedure(), which returns NULL instead."
    echo "$bad" | sed 's/^/        /'
    rc=1
  else
    say "ok -- every literal is resolved through to_regprocedure first"
  fi
else
  say "ok -- none"
fi

echo "== 2. references to functions that exist only in the local shim"
for fn in $SHIM_ONLY; do
  hits=$(grep -nE "\b$fn\b" "${FILES[@]}" | grep -vE "^\s*[^:]+:[0-9]+:\s*--" || true)
  if [ -n "$hits" ]; then
    say "FAIL -- '$fn' is created only by tests/0000_local_supabase_shim.sql"
    say "        and does not exist on the hosted platform:"
    echo "$hits" | sed 's/^/        /'
    rc=1
  fi
done
[ $rc -eq 0 ] && say "ok -- none (shim-only names: $(echo $SHIM_ONLY | tr '\n' ' '))"

echo "== 3. ACL text literals that hardcode an owner role"
hits=$(grep -nE "'[a-z_]*=[a-zA-Z]+/[a-z_]+'" "${FILES[@]}" | grep -vE "^[^:]+:[0-9]+:[[:space:]]*--" || true)
if [ -n "$hits" ]; then
  say "FAIL -- an ACL string literal embeds an owner name. It silently stops"
  say "        matching when the owner differs. Use aclexplode() instead."
  echo "$hits" | sed 's/^/        /'
  rc=1
else
  say "ok -- none"
fi

echo "== 4. current_setting without the missing_ok flag"
hits=$(grep -nE "current_setting\([^)]*\)" "${FILES[@]}" | grep -vE "current_setting\([^,]*,\s*true\s*\)" || true)
if [ -n "$hits" ]; then
  say "FAIL -- current_setting() without missing_ok raises when the GUC is unset:"
  echo "$hits" | sed 's/^/        /'
  rc=1
else
  say "ok -- none"
fi

echo "== 5. roles and non-public schemas the bundle depends on"
echo "     (asserted at run time by PRE_DEPLOY_AUDIT; listed here for review)"
grep -ohE "\b(auth|extensions|storage|graphql|vault)\.[a-z_]+\(?" "${FILES[@]}" | sort -u | sed 's/^/     schema  /'
grep -ohE "\b(anon|authenticated|authenticator|service_role)\b" "${FILES[@]}" | sort -u | sed 's/^/     role    /'

echo
[ $rc -eq 0 ] && echo "ENV AUDIT: CLEAN" || echo "ENV AUDIT: FINDINGS -- build must not ship"
exit $rc
