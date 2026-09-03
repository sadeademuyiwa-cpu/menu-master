#!/usr/bin/env bash
# Prove every PostgREST embed in the application against REAL PostgREST.
#
# A mock cannot fail a rule it does not model. e2e/mock-supabase.mjs returns
# pre-shaped objects and does not implement embedding, which is why an
# ambiguous order_lines -> recipes embed passed fifteen browser assertions and
# then returned PGRST201 / HTTP 300 in production.
#
# This builds a real 0048 schema, points real PostgREST at it, and asks the
# application's own embed expressions for rows.
#
# Requires: the local PostgreSQL replica harness on 55432, and a postgrest
# binary (PGRST_BIN, default /tmp/postgrest).
set -uo pipefail
R="$(cd "$(dirname "$0")/.." && pwd)"
DB="${DB:-embedcheck}"
PGRST_BIN="${PGRST_BIN:-/tmp/postgrest}"
PORT="${PORT:-3001}"
SECRET='super-secret-jwt-token-with-at-least-32-characters-long'

[ -x "$PGRST_BIN" ] || { echo "SKIP: no postgrest binary at $PGRST_BIN"; exit 0; }
psql -h 127.0.0.1 -p 55432 -U postgres -tAc 'select 1' >/dev/null 2>&1 \
  || { echo "SKIP: no PostgreSQL on 127.0.0.1:55432"; exit 0; }

echo "building a 0048 schema in $DB ..."
bash /tmp/setup_db.sh "$DB" 0048 >/dev/null 2>&1 || { echo "FAIL: could not build $DB"; exit 1; }

psql -h 127.0.0.1 -p 55432 -U postgres -d "$DB" -q -c "
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='authenticator') then
    create role authenticator login password 'authenticator';
  end if;
  alter role authenticator with login password 'authenticator';
  grant anon, authenticated to authenticator;
end \$\$;" >/dev/null 2>&1

CONF=$(mktemp)
cat > "$CONF" <<CONFEOF
db-uri = "postgres://authenticator:authenticator@127.0.0.1:55432/$DB"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
jwt-role-claim-key = ".role"
server-port = $PORT
server-host = "127.0.0.1"
db-pool = 4
CONFEOF

fuser -k ${PORT}/tcp 2>/dev/null
"$PGRST_BIN" "$CONF" > /tmp/pgrst-embedcheck.log 2>&1 &
PGRST_PID=$!
cleanup () { kill "$PGRST_PID" 2>/dev/null; rm -f "$CONF"; }
trap cleanup EXIT

for i in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/)" = "200" ] && break
  sleep 1
done
[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/)" = "200" ] || {
  echo "FAIL: postgrest did not start"; tail -5 /tmp/pgrst-embedcheck.log; exit 1; }

export PGRST_URL="http://127.0.0.1:$PORT"
export PGRST_JWT=$(python3 -c "
import base64,hmac,hashlib,json,time
def b(o): return base64.urlsafe_b64encode(json.dumps(o).encode()).rstrip(b'=')
h=b({'alg':'HS256','typ':'JWT'})
p=b({'role':'authenticated','sub':'00000000-0000-0000-0000-000000000099','exp':int(time.time())+3600})
sig=base64.urlsafe_b64encode(hmac.new(b'$SECRET', h+b'.'+p, hashlib.sha256).digest()).rstrip(b'=')
print((h+b'.'+p+b'.'+sig).decode())")

cd "$R/web" && node e2e/postgrest-embeds.mjs
