#!/usr/bin/env bash
# Build a database under PRE-Phase-6 rules, migrate it, and prove the owner's
# historical figures did not move. The ordinary suites cannot do this: they all
# run on a database already migrated to head.
set -u
DB="${1:-mmlegacyreplay}"
H="-h 127.0.0.1 -p 55432 -U postgres"
R="$(cd "$(dirname "$0")/.." && pwd)"

"$(dirname "$0")/../../tmp/setup_db.sh" "$DB" 0042 >/dev/null 2>&1 \
  || /tmp/setup_db.sh "$DB" 0042 >/dev/null 2>&1 \
  || { echo "could not build $DB at 0042"; exit 1; }

psql $H -d "$DB" -q -v ON_ERROR_STOP=1 -f "$R/docs/audits/PHASE6_LEGACY_REPLAY.sql" || exit 1

for n in 0043 0044 0045 0046 0047 0048; do
  f=$(ls "$R"/migrations/proposed/${n}_*.sql | grep -v _rollback | head -1)
  out=$(psql $H -d "$DB" -q -1 -v ON_ERROR_STOP=1 -f "$f" 2>&1)
  echo "$out" | grep -E "NOTICE:  0045:" || true
  if echo "$out" | grep -qE "^psql.*ERROR"; then
    echo "FAIL applying $(basename "$f")"; echo "$out" | grep -E "ERROR" | head -3; exit 1
  fi
done

psql $H -d "$DB" -v assert=1 -f "$R/docs/audits/PHASE6_LEGACY_REPLAY.sql"
