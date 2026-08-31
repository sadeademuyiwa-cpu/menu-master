#!/usr/bin/env bash
# PRODUCTION-FAITHFUL replica.
#
# Identical to setup_db.sh except that immediately after the local Supabase
# shim it removes the objects the shim provides which the hosted platform does
# NOT provide. Right now that is exactly one: public.local_pre_request(), which
# the shim itself documents as "LOCAL ONLY ... Never run against Supabase".
#
# Everything else the shim creates -- the anon/authenticated/service_role/
# authenticator roles, the auth schema, auth.users, auth.uid(), auth.role(),
# and the public-schema default privileges -- the hosted platform DOES provide,
# so those are kept.
set -u
DB="$1"; UPTO="${2:-9999}"
H="-h 127.0.0.1 -p 55432 -U postgres"
R=/home/user/menu-master
psql $H -q -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null 2>&1
PG="psql $H -d $DB -v ON_ERROR_STOP=1 -q"
$PG -f "$R/tests/0000_local_supabase_shim.sql" >/tmp/shim.log 2>&1 || { echo "FAIL shim"; tail -5 /tmp/shim.log; exit 1; }
$PG -c "drop function if exists public.local_pre_request();" >/dev/null 2>&1 \
  || { echo "FAIL de-shim"; exit 1; }
apply () {
  if out=$($PG -f "$1" 2>&1 | grep -i "^ERROR\|^psql.*ERROR"); then
    echo "FAIL $(basename $1)"; echo "$out" | head -8; return 1
  fi
}
for f in "$R"/migrations/0*.sql; do apply "$f" || exit 1; done
for f in /tmp/replica_mig/00*.sql; do apply "$f" || exit 1; done
for n in 0031 0032 0033 0034 0035 0036 0037 0038 0039 0040 0041 0042 \
         0043 0044 0045 0046 0047 0048; do
  [ "$n" \> "$UPTO" ] && continue
  f=$(ls "$R"/migrations/proposed/${n}_*.sql 2>/dev/null | grep -v _rollback | head -1)
  [ -z "$f" ] && { echo "MISSING $n"; exit 1; }
  apply "$f" || exit 1
done
echo "OK: migrations up to $UPTO applied to $DB (production-faithful: no local_pre_request)"
