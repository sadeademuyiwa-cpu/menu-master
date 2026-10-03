#!/usr/bin/env bash
# Build a Menu Master NG database from the repository alone.
#
# Applies the local Supabase shim, the LOCAL-ONLY test fixtures, then every
# migration in migrations/ in order, each under --single-transaction exactly as
# production is migrated (0049 onward refuses any other executor). Nothing
# outside this repository is needed: the production-specific preflights in
# 0019c-0030 are skipped under mm.fresh_install = on, and every self-check still
# runs.
#
# This is the CI/Linux twin of scripts/setup_db.ps1. Both apply the same files in
# the same order; if they ever disagree, the chain is wrong, not the script.
#
#   scripts/setup_db.sh <db> [upto] [--with-proposed]
#
#     upto             last migration number to apply, e.g. 0025 (default: all)
#     --with-proposed  after migrations/, also apply migrations/proposed/*.sql,
#                      so the acceptance suite of a migration can run before it
#                      ships
#
# Records the last applied number as the database setting mm.migration_level,
# which run_suites reads to honour tests/MANIFEST.
#
# Connection: PGHOST/PGPORT/PGUSER/PGPASSWORD as psql reads them (defaults
# 127.0.0.1 / 55433 / postgres).
set -u
DB="${1:?usage: setup_db.sh <db> [upto] [--with-proposed]}"
UPTO="9999"; WITH_PROPOSED=0
for a in "${@:2}"; do
  case "$a" in
    --with-proposed) WITH_PROPOSED=1 ;;
    *) UPTO="$a" ;;
  esac
done
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-55433}" PGUSER="${PGUSER:-postgres}"
R="$(cd "$(dirname "$0")/.." && pwd)"

apply () {
  local out
  out=$(psql -d "$DB" -v ON_ERROR_STOP=1 --single-transaction -q -f "$1" 2>&1)
  if [ $? -ne 0 ] || printf '%s' "$out" | grep -qE '^(psql:.*)?ERROR:'; then
    echo "FAIL $(basename "$1")"
    printf '%s\n' "$out" | grep -E 'ERROR|DETAIL|HINT' | head -8
    exit 1
  fi
}

psql -d postgres -q -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null
apply "$R/tests/0000_local_supabase_shim.sql"
# local-only fixtures: the auth users the boundary suites resolve by email
for f in "$R"/tests/fixtures/*.sql; do [ -f "$f" ] && apply "$f"; done
psql -d "$DB" -q -c "alter database $DB set mm.fresh_install = 'on';" >/dev/null

n=0; last=0000
for f in "$R"/migrations/0*.sql; do
  num=$(basename "$f" | cut -d_ -f1 | sed 's/[a-z]$//')
  [ "$num" \> "$UPTO" ] && break
  apply "$f"; n=$((n+1)); last="$num"
done
if [ "$WITH_PROPOSED" = 1 ]; then
  for f in "$R"/migrations/proposed/0*.sql; do
    [ -f "$f" ] || continue
    num=$(basename "$f" | cut -d_ -f1 | sed 's/[a-z]$//')
    [ "$num" \> "$UPTO" ] && break
    apply "$f"; n=$((n+1)); last="$num"
  done
fi
psql -d "$DB" -q -c "alter database $DB set mm.migration_level = '$last';" >/dev/null
echo "OK: $n migration(s) applied to $DB (fresh install, level $last$([ "$WITH_PROPOSED" = 1 ] && echo ', proposed included'))"
