#!/usr/bin/env bash
# Does a failure halfway through a migration leave the database half-changed?
#
# The Supabase SQL Editor does not honour transaction control -- that is how
# production ended up partially migrated once already. This proves a migration
# is safe to fail when run the way we intend: psql --single-transaction.
#
#   scripts/atomicity_check.sh <migration.sql> "<anchor>|<what has happened>" ... 
#
# Injection points are anchored to TEXT, not line numbers: a line number
# silently drifts when the file is edited, and an injection that lands inside a
# dollar-quoted body becomes a string literal that never fires. Each run
# therefore asserts that the injected error actually appeared. Use @END@ for an
# injection after the last statement.
#
# The "before" database must already exist and be named by BASE_DB.
set -uo pipefail
M="${1:?usage: atomicity_check.sh <migration.sql> \"anchor|description\" ...}"
shift
BASE_DB="${BASE_DB:?set BASE_DB to a template database at the migration BEFORE this one}"
DB="${DB:-atomcheck}"
H="-h 127.0.0.1 -p ${PGPORT:-55432} -U postgres"
BOOM="do \$boom\$ begin raise exception 'INJECTED FAILURE for atomicity rehearsal'; end \$boom\$;"

psql $H -q -c "drop database if exists $DB;" -c "create database $DB template $BASE_DB;" >/dev/null 2>&1 \
  || { echo "could not build the baseline from $BASE_DB"; exit 1; }
/tmp/fingerprint.sh "$DB" > /tmp/atom_base.txt
BASE=$(md5sum < /tmp/atom_base.txt | cut -d' ' -f1)
echo "migration : $(basename "$M")  md5 $(md5sum "$M" | cut -d' ' -f1)"
echo "baseline  : $BASE  ($(wc -l < /tmp/atom_base.txt) lines, from $BASE_DB)"
echo
BAD=0
for entry in "$@"; do
  A="${entry%%|*}"; DESC="${entry#*|}"
  if [ "$A" = "@END@" ]; then
    { cat "$M"; echo "$BOOM"; } > /tmp/atom_mig.sql
  else
    n=$(grep -Fxn -- "$A" "$M" | head -1 | cut -d: -f1)
    [ -z "$n" ] && { echo "anchor not found, refusing to report a pass: $A"; BAD=1; continue; }
    awk -v n="$n" -v b="$BOOM" 'NR==n{print b} {print}' "$M" > /tmp/atom_mig.sql
  fi

  ERR=$(psql $H -d "$DB" -q -v ON_ERROR_STOP=1 --single-transaction -f /tmp/atom_mig.sql 2>&1 \
          | grep -m1 "INJECTED FAILURE")
  AFTER=$(/tmp/fingerprint.sh "$DB" | md5sum | cut -d' ' -f1)

  echo "failing where $DESC"
  if [ -z "$ERR" ]; then
    echo "  INJECTION DID NOT FIRE -- this run proves nothing"; BAD=1
  else
    echo "  error raised : ${ERR##*ERROR:  }"
  fi
  if [ "$AFTER" = "$BASE" ]; then
    echo "  schema after : $AFTER  identical to the baseline -- nothing partial remains"
  else
    echo "  schema after : $AFTER  *** DIFFERS -- PARTIAL STATE ***"; BAD=1
  fi
  echo
done

if psql $H -d "$DB" -q -v ON_ERROR_STOP=1 --single-transaction -f "$M" 2>&1 | grep -qE "OK:"; then
  echo "the clean file still applies after the aborted attempts: OK"
else
  echo "*** the clean file FAILED after the aborted attempts ***"; BAD=1
fi

echo
echo "and the wrong executor (autocommit, i.e. the SQL Editor):"
psql $H -q -c "drop database if exists ${DB}_nx;" -c "create database ${DB}_nx template $BASE_DB;" >/dev/null 2>&1
NXB=$(/tmp/fingerprint.sh "${DB}_nx" | md5sum | cut -d' ' -f1)
psql $H -d "${DB}_nx" -q -v ON_ERROR_STOP=1 -f "$M" 2>&1 | grep -m1 "ABORT" | sed 's/^/  /'
NXA=$(/tmp/fingerprint.sh "${DB}_nx" | md5sum | cut -d' ' -f1)
if [ "$NXA" = "$NXB" ]; then
  echo "  refused before any object was touched ($NXA)"
else
  echo "  *** PARTIAL STATE LEFT BEHIND ***"; BAD=1
fi
exit $BAD
