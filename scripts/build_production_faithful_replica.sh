#!/usr/bin/env bash
# PRODUCTION-FAITHFUL replica: setup_db.sh, then remove the one object the local
# shim provides which the hosted platform does NOT -- public.local_pre_request(),
# documented in the shim as "LOCAL ONLY ... Never run against Supabase".
#   scripts/build_production_faithful_replica.sh <db> [upto]
set -u
R="$(cd "$(dirname "$0")/.." && pwd)"
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-55433}" PGUSER="${PGUSER:-postgres}"
"$R/scripts/setup_db.sh" "$1" "${2:-9999}" || exit 1
psql -d "$1" -q -c "drop function if exists public.local_pre_request();" >/dev/null \
  && echo "OK: $1 is production-faithful (no local_pre_request)"