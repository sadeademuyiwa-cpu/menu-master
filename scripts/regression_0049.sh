#!/usr/bin/env bash
# Every SQL suite in tests/, run twice: once on a 0048 database and once on a
# 0049 database, each suite getting a virgin copy so no suite can contaminate
# the next. The comparison, not the absolute number, is the evidence -- several
# suites are historical (gate1/gate2 era) and were never expected to pass at
# head. A regression is any suite whose result CHANGES between 0048 and 0049.
set -u
H="-h 127.0.0.1 -p ${PGPORT:-55432} -U postgres"
R=/home/user/menu-master
M="$R/migrations/proposed/0049_billing_tiers_and_founders.sql"

result () {  # suite db
  local out line p f
  out=$(psql $H -d "$2" -f "$R/tests/$1" 2>&1)
  line=$(echo "$out" | grep -E '^ +[0-9]+ \| +[0-9]+( \| +[0-9]+)? *$' | tail -1)
  p=$(echo "$line" | awk -F'|' '{gsub(/ /,"");print $1}')
  f=$(echo "$line" | awk -F'|' '{gsub(/ /,"");print $2}')
  if [ -z "${p:-}" ]; then echo "NO RESULT"; else echo "pass=$p fail=$f"; fi
}

echo "building the 0048 and 0049 templates ..."
/tmp/setup_db.sh tpl48 0048 >/dev/null 2>&1 || { echo "0048 template failed"; exit 1; }
psql $H -q -c "drop database if exists tpl49;" -c "create database tpl49 template tpl48;" >/dev/null 2>&1
psql $H -d tpl49 -q -v ON_ERROR_STOP=1 --single-transaction -f "$M" >/dev/null 2>&1 \
  || { echo "0049 template failed"; exit 1; }
echo "0049 md5: $(md5sum "$M" | cut -d' ' -f1)"
echo
printf '%-44s %-16s %-16s %s\n' SUITE "AT 0048" "AT 0049" VERDICT
printf '%-44s %-16s %-16s %s\n' "--------------------------------------------" "---------------" "---------------" "-------"
REG=0; SAME=0
for f in "$R"/tests/0*.sql; do
  s=$(basename "$f")
  [ "$s" = 0000_local_supabase_shim.sql ] && continue
  psql $H -q -c "drop database if exists r48;" -c "drop database if exists r49;" \
              -c "create database r48 template tpl48;" -c "create database r49 template tpl49;" >/dev/null 2>&1
  a=$(result "$s" r48); b=$(result "$s" r49)
  if [ "$s" = 035_billing_tiers_and_founders.sql ]; then
    v="new suite (0048 cannot pass it)"
  elif [ "$a" = "$b" ]; then v=same; SAME=$((SAME+1))
  else v="*** CHANGED ***"; REG=$((REG+1)); fi
  printf '%-44s %-16s %-16s %s\n' "$s" "$a" "$b" "$v"
done
echo
echo "pre-existing suites unchanged by 0049: $SAME    regressions: $REG"
