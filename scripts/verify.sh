#!/usr/bin/env bash
# Local verification harness. Fresh DB every run — the suites insert fixtures and are not idempotent.
# usage: run.sh <dbname> [last_migration_prefix]
set -u
DB="$1"; UPTO="${2:-9999}"
H="-h 127.0.0.1 -p 55432 -U postgres"
R=$(cd "$(dirname "$0")/.." && pwd)
psql $H -q -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null 2>&1
PG="psql $H -d $DB -v ON_ERROR_STOP=1 -q"
$PG -f "$R/tests/0000_local_supabase_shim.sql" >/dev/null 2>&1 || { echo "FAIL shim"; exit 1; }
for f in "$R"/migrations/0*.sql; do
  n=$(basename "$f"); num=${n%%_*}
  [ "$num" \> "$UPTO" ] && continue
  if out=$($PG -f "$f" 2>&1); then echo "  ok  $n"; else echo "  FAIL $n"; echo "$out" | head -15; exit 1; fi
done
echo "  --- migrations applied ---"
for suite in "$R"/tests/0[0-9][0-9]_*.sql; do
  s=$(basename "$suite")
  case "$s" in 0000_*|003_*|006_*|007_*) continue;; esac
  res=$(psql $H -d "$DB" -f "$suite" 2>&1 | grep -E '^ +[0-9]+ \| +[0-9]+ \| +[0-9]+$' | tail -1 | awk -F'|' '{gsub(/ /,"");printf "passed=%s failed=%s total=%s",$1,$2,$3}')
  fails=$(psql $H -d "$DB" -tAc "select coalesce(string_agg(name,' | '),'') from (select name from _test_results where not passed union all select name from _g1 where not passed union all select name from _c1 where not passed union all select role_name||' '||tbl||' '||op from _m1 where not passed) x;" 2>/dev/null)
  echo "  $s -> ${res:-NO RESULT}"
  [ -n "$fails" ] && echo "      FAILING: $fails"
done
