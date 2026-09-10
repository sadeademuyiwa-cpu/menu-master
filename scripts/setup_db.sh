#!/usr/bin/env bash
# Build a Menu Master NG database from the repository alone.
#
# Applies the local Supabase shim, then every migration in migrations/ in order,
# into a fresh database, each file under --single-transaction exactly as production
# is migrated (0049 onward refuses any other executor). Nothing outside this repository is needed: the
# production-specific preflights in 0019c-0030 are skipped under
# mm.fresh_install = on, and every self-check still runs.
#
# This is the CI/Linux twin of scripts/setup_db.ps1. Both apply the same files in
# the same order; if they ever disagree, the chain is wrong, not the script.
#
#   scripts/setup_db.sh <db> [upto]        e.g. scripts/setup_db.sh mm 0051
#
# Connection: PGHOST/PGPORT/PGUSER/PGPASSWORD as psql reads them (defaults
# 127.0.0.1 / 55433 / postgres).
set -u
DB="${1:?usage: setup_db.sh <db> [upto]}"
UPTO="${2:-9999}"
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
psql -d "$DB" -q -c "alter database $DB set mm.fresh_install = 'on';" >/dev/null

n=0
for f in "$R"/migrations/0*.sql; do
  num=$(basename "$f" | cut -d_ -f1 | sed 's/[a-z]$//')
  [ "$num" \> "$UPTO" ] && break
  apply "$f"; n=$((n+1))
done
echo "OK: $n migration(s) applied to $DB (fresh install, up to $UPTO)"
