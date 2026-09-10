#!/usr/bin/env bash
# Run every SQL suite in tests/ against a virgin copy of a built database, so no
# suite can contaminate the next, and fail if any suite that produces a result
# reports a failure.
#
#   scripts/run_suites.sh <template-db>          (build it first: setup_db.sh)
#
# A suite "produces a result" when it ends with the pass|fail summary row every
# suite from 001 onward prints. Suites that print no summary (003, 006-010, 012)
# are reported as NO RESULT and do not fail the run: they depend on fixtures
# that exist only in a Supabase console, or re-apply an era-specific migration.
set -u
TPL="${1:?usage: run_suites.sh <template-db>}"
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-55433}" PGUSER="${PGUSER:-postgres}"
R="$(cd "$(dirname "$0")/.." && pwd)"

fail_total=0; pass_total=0; suites=0; noresult=0
printf '%-46s %s\n' SUITE RESULT
for f in "$R"/tests/0*.sql; do
  s=$(basename "$f"); [ "$s" = 0000_local_supabase_shim.sql ] && continue
  psql -d postgres -q -c "drop database if exists suite_run;" -c "create database suite_run template $TPL;" >/dev/null
  # ALTER DATABASE ... SET is not copied by CREATE DATABASE ... TEMPLATE, so every copy must re-assert the fresh-install flag
  psql -d postgres -q -c "alter database suite_run set mm.fresh_install = 'on';" >/dev/null
  out=$(psql -d suite_run -f "$f" 2>&1)
  line=$(printf '%s\n' "$out" | grep -E '^ +[0-9]+ \| +[0-9]+( \| +[0-9]+)? *$' | tail -1)
  p=$(printf '%s' "$line" | awk -F'|' '{gsub(/ /,"");print $1}')
  fl=$(printf '%s' "$line" | awk -F'|' '{gsub(/ /,"");print $2}')
  if [ -z "${p:-}" ]; then printf '%-46s %s\n' "$s" "NO RESULT"; noresult=$((noresult+1)); continue; fi
  printf '%-46s pass=%s fail=%s\n' "$s" "$p" "$fl"
  suites=$((suites+1)); pass_total=$((pass_total+p)); fail_total=$((fail_total+fl))
done
echo
echo "suites=$suites  pass=$pass_total  fail=$fail_total  no-result=$noresult"
[ "$fail_total" -eq 0 ]
