#!/usr/bin/env bash
# Run every SQL suite in tests/ the way tests/MANIFEST says it must be run, and
# fail on any failure. CI/Linux twin of scripts/run_suites.ps1.
#
#   scripts/run_suites.sh <head-db>        (built first by setup_db.sh)
#
# Per suite (see tests/MANIFEST for the vocabulary):
#   default        a virgin copy of the head database
#   era=NNNN       a database built only up to NNNN, cached as <head-db>_era_NNNN
#   requires=NNNN  skipped with a reason if the head database is below NNNN
#   seq=NAME       members share ONE copy, in file order
#   rows           FAIL rows count even without a summary row
#   skip=REASON    never run
#
# ALTER DATABASE ... SET is not copied by CREATE DATABASE ... TEMPLATE, so every
# copy re-asserts the fresh-install flag.
set -u
HEAD="${1:?usage: run_suites.sh <head-db>}"
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-55433}" PGUSER="${PGUSER:-postgres}"
R="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$R/tests/MANIFEST"
LEVEL=$(psql -d "$HEAD" -tAc "select current_setting('mm.migration_level', true)")
[ -z "$LEVEL" ] && { echo "the head database records no mm.migration_level; build it with setup_db.sh"; exit 2; }

manifest_get () { # suite key -> value or empty
  grep -E "^$1[[:space:]]" "$MANIFEST" 2>/dev/null | grep -oE "(^|[[:space:]])$2=[^[:space:]]*" | head -1 | sed "s/^[[:space:]]*$2=//"
}
manifest_skip () { grep -E "^$1[[:space:]]" "$MANIFEST" 2>/dev/null | sed -n 's/.*skip=//p' | head -1; }
manifest_has () { grep -E "^$1[[:space:]].*(^|[[:space:]])$2([[:space:]]|$)" "$MANIFEST" >/dev/null 2>&1; }

fresh_copy () { # name template
  psql -d postgres -q -c "drop database if exists $1;" -c "create database $1 template $2;" >/dev/null
  psql -d postgres -q -c "alter database $1 set mm.fresh_install = 'on';" >/dev/null
}
era_db () { # NNNN -> ensures <HEAD>_era_NNNN exists, echoes its name
  local name="${HEAD}_era_$1"
  if ! psql -d postgres -tAc "select 1 from pg_database where datname='$name'" | grep -q 1; then
    "$R/scripts/setup_db.sh" "$name" "$1" >/dev/null || { echo "could not build era database $name"; exit 2; }
  fi
  echo "$name"
}

run_one () { # suite db -> prints "pass fail" or "NO RESULT"
  local out line p f rows
  out=$(psql -d "$2" -f "$R/tests/$1" 2>&1)
  line=$(printf '%s\n' "$out" | grep -E '^ +[0-9]+ \| +[0-9]+( \| +[0-9]+)? *$' | tail -1)
  if [ -n "$line" ]; then
    p=$(printf '%s' "$line" | awk -F'|' '{gsub(/ /,"");print $1}')
    f=$(printf '%s' "$line" | awk -F'|' '{gsub(/ /,"");print $2}')
    echo "$p $f"; return
  fi
  if manifest_has "$1" rows; then
    rows=$(printf '%s\n' "$out" | grep -cE '\| *(PASS|OK) *(\||$)')
    f=$(printf '%s\n' "$out" | grep -cE '\| *(FAIL|WRONG) *(\||$)')
    echo "$rows $f"; return
  fi
  echo "NO RESULT"
}

pass_total=0; fail_total=0; suites=0; noresult=0; skipped=0
printf '%-40s %-10s %s\n' SUITE DB RESULT
declare -A seqdb
for file in "$R"/tests/0*.sql; do
  s=$(basename "$file"); [ "$s" = 0000_local_supabase_shim.sql ] && continue
  reason=$(manifest_skip "$s")
  if [ -n "$reason" ]; then printf '%-40s %-10s SKIP  %s\n' "$s" - "$reason"; skipped=$((skipped+1)); continue; fi
  req=$(manifest_get "$s" requires)
  if [ -n "$req" ] && [ "$LEVEL" \< "$req" ]; then
    printf '%-40s %-10s SKIP  requires %s, head is %s\n' "$s" - "$req" "$LEVEL"; skipped=$((skipped+1)); continue
  fi
  era=$(manifest_get "$s" era); seq=$(manifest_get "$s" seq)
  tpl="$HEAD"; label=head
  if [ -n "$era" ]; then tpl=$(era_db "$era"); label="era $era"; fi
  if [ -n "$seq" ]; then
    db="suite_seq_$seq"
    if [ -z "${seqdb[$seq]:-}" ]; then fresh_copy "$db" "$tpl"; seqdb[$seq]=1; fi
  else
    db=suite_run; fresh_copy "$db" "$tpl"
  fi
  res=$(run_one "$s" "$db")
  if [ "$res" = "NO RESULT" ]; then printf '%-40s %-10s NO RESULT\n' "$s" "$label"; noresult=$((noresult+1)); continue; fi
  p=${res% *}; f=${res#* }
  printf '%-40s %-10s pass=%s fail=%s%s\n' "$s" "$label" "$p" "$f" "$([ "$f" -gt 0 ] && echo '  FAIL')"
  suites=$((suites+1)); pass_total=$((pass_total+p)); fail_total=$((fail_total+f))
done
echo
echo "head level $LEVEL  suites=$suites  pass=$pass_total  fail=$fail_total  no-result=$noresult  skipped=$skipped"
[ "$fail_total" -eq 0 ]
