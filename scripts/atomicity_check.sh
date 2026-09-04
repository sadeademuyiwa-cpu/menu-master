#!/usr/bin/env bash
# Does a failure halfway through 0049 leave production half-migrated?
#
# The Supabase SQL Editor does not honour transaction control -- that is how
# production ended up partially migrated once already. This proves the file is
# safe to fail when it is run the way we intend to run it: psql
# --single-transaction. A failure is injected at four deliberately chosen
# points, and after each the whole schema fingerprint must be byte-identical to
# the untouched 0048 baseline.
#
# The injection points are anchored to TEXT, not line numbers: a line number
# silently drifts when the file is edited, and an injection that lands inside a
# dollar-quoted body becomes a string literal that never fires. Each run
# therefore asserts that the injected error actually appeared.
set -uo pipefail
DB="${1:-atom}"
R=/home/user/menu-master
M="$R/migrations/proposed/0049_billing_tiers_and_founders.sql"
H="-h 127.0.0.1 -p ${PGPORT:-55432} -U postgres"
BOOM="do \$boom\$ begin raise exception 'INJECTED FAILURE for atomicity rehearsal'; end \$boom\$;"

# anchor | what has already happened by the time we blow up
ANCHORS=(
"insert into founder_slots (seq) select generate_series(1,100);|the new tables exist and are seeded"
"create or replace function fn_account_has_sales(p_account_id uuid)|the columns, constraints, plan rows and slots are all in"
"create policy p_orders_insert on orders for insert with check (|an RLS write policy has been DROPPED and not yet recreated"
"@END@|every change is made and we are one statement from COMMIT"
)

/tmp/setup_db.sh "$DB" 0048 >/dev/null || { echo "could not build the 0048 baseline"; exit 1; }
/tmp/fingerprint.sh "$DB" > /tmp/atom_base.txt
BASE=$(md5sum < /tmp/atom_base.txt | cut -d' ' -f1)
echo "0049 md5:                  $(md5sum "$M" | cut -d' ' -f1)"
echo "0048 baseline fingerprint: $BASE  ($(wc -l < /tmp/atom_base.txt) lines)"
echo
BAD=0
for entry in "${ANCHORS[@]}"; do
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
    echo "  schema after : $AFTER  identical to 0048 -- nothing partial remains"
  else
    echo "  schema after : $AFTER  *** DIFFERS FROM 0048 -- PARTIAL STATE ***"; BAD=1
  fi
  echo
done

# and, having failed four times, the unmodified file must still apply cleanly
if psql $H -d "$DB" -q -v ON_ERROR_STOP=1 --single-transaction -f "$M" 2>&1 | grep -q "0049 OK"; then
  echo "the clean file still applies after four aborted attempts: OK"
else
  echo "*** the clean file FAILED after the aborted attempts ***"; BAD=1
fi
exit $BAD
