#!/usr/bin/env bash
# ============================================================================
# MENU MASTER NG — Supabase production-boundary test
#
# DISPOSABLE PROJECT ONLY. Never point this at production.
#
# Replays the Gate 1 cross-tenant attacks through the real PostgREST API, using
# genuine end-user JWTs. The SQL Editor is deliberately NOT used: it runs
# privileged and would prove nothing about what a hostile client can do.
#
# Required env:
#   SUPABASE_URL SUPABASE_ANON_KEY
#   USER_A_EMAIL USER_A_PASSWORD USER_B_EMAIL USER_B_PASSWORD
#   CASHIER_B_EMAIL CASHIER_B_PASSWORD
#   ACCOUNT_A BUSINESS_A INGREDIENT_A BUSINESS_B   (from the fixtures output)
# Optional, for --service-context-check:
#   SUPABASE_SERVICE_KEY
# ============================================================================
set -uo pipefail
: "${SUPABASE_URL:?set SUPABASE_URL}"; : "${SUPABASE_ANON_KEY:?set SUPABASE_ANON_KEY}"
PASS=0; FAIL=0

signin() { curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))'; }

rpc() { # rpc <jwt> <fn> <json-args>
  curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/$2" \
    -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $1" \
    -H "Content-Type: application/json" -d "$3"; }

rest() { curl -s "$SUPABASE_URL/rest/v1/$2" \
    -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $1"; }

check() { # check <name> <expect: BLOCKED|EMPTY> <response>
  local name="$1" expect="$2" body="$3" got
  if echo "$body" | grep -qiE '"(code|message)"[[:space:]]*:|permission|not authorized|does not permit'; then got=BLOCKED
  elif [ "$body" = "[]" ] || [ "$body" = "null" ] || [ -z "$body" ]; then got=EMPTY
  else got=ALLOWED; fi
  if [ "$got" = "$expect" ] || { [ "$expect" = "BLOCKED" ] && [ "$got" = "EMPTY" ]; }; then
    echo "  [PASS] $name ($got)"; PASS=$((PASS+1))
  else
    echo "  [FAIL] $name -> $got"; echo "         $body" | head -c 300; echo; FAIL=$((FAIL+1))
  fi; }

if [ "${1:-}" = "--service-context-check" ]; then
  : "${SUPABASE_SERVICE_KEY:?set SUPABASE_SERVICE_KEY}"
  echo "=== THE DECISIVE TEST: service context ==="
  SVC=$(curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/fn_is_service_context" \
        -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
        -H "Content-Type: application/json" -d '{}')
  echo "  service_role key, no user JWT      -> $SVC   (MUST be true)"
  JWT=$(signin "$USER_A_EMAIL" "$USER_A_PASSWORD")
  USR=$(rpc "$JWT" fn_is_service_context '{}')
  echo "  end-user JWT                        -> $USR   (MUST be false)"
  MIX=$(curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/fn_is_service_context" \
        -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $JWT" \
        -H "Content-Type: application/json" -d '{}')
  echo "  service_role apikey + user JWT      -> $MIX   (MUST be false)"
  echo
  echo "If the third line is true, the production boundary is BROKEN and Gate 1 fails."
  exit 0
fi

: "${ACCOUNT_A:?}"; : "${BUSINESS_A:?}"; : "${INGREDIENT_A:?}"; : "${BUSINESS_B:?}"
echo "=== signing in as real users ==="
JWT_A=$(signin "$USER_A_EMAIL" "$USER_A_PASSWORD")
JWT_B=$(signin "$USER_B_EMAIL" "$USER_B_PASSWORD")
JWT_C=$(signin "$CASHIER_B_EMAIL" "$CASHIER_B_PASSWORD")
[ -z "$JWT_B" ] && { echo "sign-in failed for user B"; exit 1; }

echo "=== ATTACK A: cross-tenant costing RPC ==="
check "A1 B reads A cost with A ids"  BLOCKED "$(rpc "$JWT_B" fn_ingredient_unit_cost "{\"p_ingredient_id\":\"$INGREDIENT_A\",\"p_business_id\":\"$BUSINESS_A\"}")"
check "A2 B mixes A ingredient + own business" BLOCKED "$(rpc "$JWT_B" fn_ingredient_unit_cost "{\"p_ingredient_id\":\"$INGREDIENT_A\",\"p_business_id\":\"$BUSINESS_B\"}")"
check "A3 B calls usable-cost variant" BLOCKED "$(rpc "$JWT_B" fn_ingredient_usable_unit_cost "{\"p_ingredient_id\":\"$INGREDIENT_A\",\"p_business_id\":\"$BUSINESS_A\"}")"

echo "=== ATTACK B: cross-tenant conversion ==="
check "B1 B reads A private paint conversion" BLOCKED "$(rpc "$JWT_B" fn_resolve_qty_to_base "{\"p_ingredient_id\":\"$INGREDIENT_A\",\"p_qty\":1,\"p_unit_id\":null}")"
check "B2 cashier probes A conversion"        BLOCKED "$(rpc "$JWT_C" fn_can_resolve_unit "{\"p_ingredient_id\":\"$INGREDIENT_A\",\"p_unit_id\":null}")"

echo "=== BYPASS: direct table reads ==="
check "X1 B selects A ingredient_prices" BLOCKED "$(rest "$JWT_B" "ingredient_prices?account_id=eq.$ACCOUNT_A")"
check "X2 B selects A cost_snapshots"    BLOCKED "$(rest "$JWT_B" "cost_snapshots?account_id=eq.$ACCOUNT_A")"
check "X9 B reads A ingredients"         BLOCKED "$(rest "$JWT_B" "ingredients?account_id=eq.$ACCOUNT_A")"
check "X13 anon reads ingredients"       BLOCKED "$(rest "$SUPABASE_ANON_KEY" "ingredients")"
check "X14 client claims service context" BLOCKED "$(rpc "$JWT_B" fn_is_service_context '{}' | grep -q true && echo '{"leak":true}' || echo '[]')"

echo
echo "================================================"
echo "  PASS=$PASS  FAIL=$FAIL"
[ "$FAIL" -gt 0 ] && echo "  PRODUCTION BOUNDARY NOT PROVEN — Gate 1 remains blocked."
echo "  Then run: $0 --service-context-check"
echo "================================================"
exit $([ "$FAIL" -gt 0 ] && echo 1 || echo 0)
