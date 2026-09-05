#!/usr/bin/env bash
# Every SQL suite in tests/, run twice: once on a database at the migration
# BEFORE the one under test, and once with that migration applied. Each suite
# gets a virgin copy so no suite can contaminate the next.
#
# The comparison, not the absolute number, is the evidence -- several suites are
# historical (gate1/gate2 era) and were never expected to pass at head. A
# regression is any suite whose result CHANGES.
#
#   scripts/regression_check.sh <migration.sql> [base-migration ...]
#
# Base migrations are applied in order on top of 0048 to build the "before"
# database, so 0050 is gated against 0049 rather than against 0048.
set -u
H="-h 127.0.0.1 -p ${PGPORT:-55432} -U postgres"
R=/home/user/menu-master
M="${1:?usage: regression_check.sh <migration.sql> [base-migration ...]}"
shift
BASES=("$@")

result () {  # suite db
  local out line p f
  out=$(psql $H -d "$2" -f "$R/tests/$1" 2>&1)
  line=$(echo "$out" | grep -E '^ +[0-9]+ \| +[0-9]+( \| +[0-9]+)? *$' | tail -1)
  p=$(echo "$line" | awk -F'|' '{gsub(/ /,"");print $1}')
  f=$(echo "$line" | awk -F'|' '{gsub(/ /,"");print $2}')
  if [ -z "${p:-}" ]; then echo "NO RESULT"; else echo "pass=$p fail=$f"; fi
}

echo "gating $(basename "$M")  md5 $(md5sum "$M" | cut -d' ' -f1)"
echo "building the before/after templates ..."
/tmp/setup_db.sh tplbefore 0048 >/dev/null 2>&1 || { echo "0048 template failed"; exit 1; }
for b in "${BASES[@]}"; do
  psql $H -d tplbefore -q -v ON_ERROR_STOP=1 --single-transaction -f "$b" >/dev/null 2>&1 \
    || { echo "base migration failed: $b"; exit 1; }
done
psql $H -q -c "drop database if exists tplafter;" -c "create database tplafter template tplbefore;" >/dev/null 2>&1
psql $H -d tplafter -q -v ON_ERROR_STOP=1 --single-transaction -f "$M" >/dev/null 2>&1 \
  || { echo "the migration under test failed to apply"; exit 1; }
echo
printf '%-46s %-16s %-16s %s\n' SUITE BEFORE AFTER VERDICT
printf '%-46s %-16s %-16s %s\n' "----------------------------------------------" "---------------" "---------------" "-------"
REG=0; SAME=0; NEW=0
for f in "$R"/tests/0*.sql; do
  s=$(basename "$f")
  [ "$s" = 0000_local_supabase_shim.sql ] && continue
  psql $H -q -c "drop database if exists rbefore;" -c "drop database if exists rafter;" \
              -c "create database rbefore template tplbefore;" \
              -c "create database rafter  template tplafter;" >/dev/null 2>&1
  a=$(result "$s" rbefore); b=$(result "$s" rafter)
  if [ "$a" = "$b" ]; then v=same; SAME=$((SAME+1))
  elif [ "$a" = "NO RESULT" ]; then v="new suite (cannot pass before)"; NEW=$((NEW+1))
  else v="*** CHANGED ***"; REG=$((REG+1)); fi
  printf '%-46s %-16s %-16s %s\n' "$s" "$a" "$b" "$v"
done
echo
echo "unchanged: $SAME   new suites: $NEW   regressions: $REG"
exit $REG
