#!/usr/bin/env bash
# Can customer 101 win a race for a founder slot?
#
# A loop in one transaction proves the cap but not the concurrency. This runs
# genuinely parallel client processes, all racing for the same hundred rows,
# and then asks the database what it actually allocated.
set -uo pipefail
DB="${1:-fc}"
H="-h 127.0.0.1 -p ${PGPORT:-55432} -U postgres"
WORKERS="${WORKERS:-30}"
PER="${PER:-6}"      # 30 x 6 = 180 claimants for 100 slots

psql $H -d "$DB" -q -v ON_ERROR_STOP=1 -c "
  delete from founder_slots;
  insert into founder_slots (seq) select generate_series(1,100);
  drop table if exists fc_claims;
  drop table if exists fc_accounts;
  create table fc_accounts as
    with ins as (
      insert into accounts (name)
      select 'race '||g from generate_series(1,$((WORKERS*PER))) g
      returning id)
    select id from ins;
  create table fc_claims (account_id uuid, seq int);" || exit 1

echo "  racing $((WORKERS*PER)) claimants for 100 slots across $WORKERS parallel processes ..."
for w in $(seq 1 "$WORKERS"); do
  psql $H -d "$DB" -q -c "
    insert into fc_claims (account_id, seq)
    select id, fn_claim_founder_slot(id)
      from (select id from fc_accounts
             order by id offset $(( (w-1)*PER )) limit $PER) a;" >/dev/null 2>&1 &
done
wait

psql $H -d "$DB" -tA -F' | ' <<'SQL'
select 'slots held',            count(*)::text from founder_slots where account_id is not null;
select 'distinct slots held',   count(distinct seq)::text from founder_slots where account_id is not null;
select 'accounts holding a slot', count(distinct account_id)::text from founder_slots where account_id is not null;
select 'claims that got a seq', count(*)::text from fc_claims where seq is not null;
select 'claims refused (null)', count(*)::text from fc_claims where seq is null;
select 'any seq issued twice?', coalesce((select string_agg(seq::text,',') from (
         select seq from fc_claims where seq is not null group by seq having count(*)>1) d),'NO');
select 'any account with 2 slots?', coalesce((select string_agg(account_id::text,',') from (
         select account_id from founder_slots where account_id is not null
          group by account_id having count(*)>1) d),'NO');
select 'slot seqs allocated', (select min(seq)||'..'||max(seq) from founder_slots where account_id is not null);
SQL
