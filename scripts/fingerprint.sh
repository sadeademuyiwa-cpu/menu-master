#!/usr/bin/env bash
# A schema fingerprint that includes the things a definition diff misses:
# view reloptions (security_invoker), grants, policies and triggers.
#   scripts/fingerprint.sh <db>     (PGHOST/PGPORT/PGUSER as psql reads them)
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-55433}" PGUSER="${PGUSER:-postgres}"
psql -d "$1" -tAF'|' <<'SQL'
select 'col', table_name, column_name, data_type, is_nullable, coalesce(column_default,'-')
  from information_schema.columns where table_schema='public' order by 2,3;
select 'fn', p.proname, md5(pg_get_functiondef(p.oid))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' order by 2,3;
select 'view', c.relname, coalesce(array_to_string(c.reloptions,','),'NONE'), md5(pg_get_viewdef(c.oid,true))
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='v' order by 2;
select 'grant', table_name, grantee, privilege_type
  from information_schema.role_table_grants where table_schema='public' order by 2,3,4;
select 'policy', schemaname, tablename, policyname, cmd
  from pg_policies where schemaname='public' order by 3,4;
select 'trigger', c.relname, t.tgname, md5(pg_get_triggerdef(t.oid))
  from pg_trigger t join pg_class c on c.oid=t.tgrelid
  join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and not t.tgisinternal order by 2,3;
select 'constraint', conrelid::regclass::text, conname, md5(pg_get_constraintdef(oid))
  from pg_constraint where connamespace='public'::regnamespace order by 2,3;
select 'type', t.typname
  from pg_type t join pg_namespace n on n.oid=t.typnamespace
 where n.nspname='public' and t.typtype='c' order by 2;
SQL