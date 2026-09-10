-- ============================================================================
-- MENU MASTER NG -- tests/041_platform_alerts.sql
--
-- Acceptance test for 0055. Run on a database with 0055 applied.
-- Rolls everything back.
--
-- The scan is idempotent, resolution is recorded rather than deleted, a
-- cleared condition resolves itself, a recurring one opens a NEW row, and the
-- client roles can neither run the scan nor read the table.
-- ============================================================================

begin;

create temp table t41 (n int, check_name text, verdict text, detail text) on commit drop;

insert into auth.users (id, email) values
  ('00000041-0000-4000-8000-000000000001', 'admin@t41.test'),
  ('00000041-0000-4000-8000-000000000002', 'owner@t41.test');
insert into platform_admins (user_id, reason) values ('00000041-0000-4000-8000-000000000001', 'test 041');

create temp table t41_ids on commit drop as
select (fn_create_account_and_business('T41 Foods','T41 Kitchen','other',
          '00000041-0000-4000-8000-000000000002', p_idempotency_key => 't41-owner')->>'account_id')::uuid as account_id;

-- start clean: whatever the database already had open is resolved by a scan
-- of the current state, which the self-check already ran
create temp table t41_base on commit drop as
select count(*) filter (where resolved_at is null) as open_before from platform_alerts;

-- a permanent billing failure and a stuck event
insert into billing_events (id, event_type, provider_event_id, reference, account_id, body_sha256,
                            signature_valid, status, last_error_code, last_error)
values ('00000041-0000-4000-8000-0000000000e1', 'charge.success', 'evt-t41-a', 'ref-t41-a',
        (select account_id from t41_ids), 'sha-t41-a', true, 'failed_permanent', 'unmapped_plan_code', 'X');
insert into billing_events (id, event_type, provider_event_id, reference, body_sha256,
                            signature_valid, status, received_at)
values ('00000041-0000-4000-8000-0000000000e2', 'charge.success', 'evt-t41-b', 'ref-t41-b',
        'sha-t41-b', true, 'received', now() - interval '40 minutes');

-- ============================================ 1. the scan
do $$
declare r1 jsonb; r2 jsonb; n_open int;
begin
  r1 := fn_admin_scan();
  r2 := fn_admin_scan();
  insert into t41 values (1,'the first scan opens the two billing alerts',
    case when (r1->>'opened')::int = 2 then 'PASS' else 'FAIL' end, r1::text);
  insert into t41 values (2,'a second scan opens nothing and refreshes both',
    case when (r2->>'opened')::int = 0 and (r2->>'refreshed')::int >= 2 then 'PASS' else 'FAIL' end, r2::text);
  insert into t41 values (3,'the permanent failure is critical and names the event',
    case when exists (select 1 from platform_alerts
                       where kind='billing_failed_permanent' and severity='critical'
                         and subject='00000041-0000-4000-8000-0000000000e1' and resolved_at is null
                         and detail->>'error_code'='unmapped_plan_code') then 'PASS' else 'FAIL' end, '');
  insert into t41 values (4,'the stuck event is a warning',
    case when exists (select 1 from platform_alerts
                       where kind='billing_stuck' and severity='warn'
                         and subject='00000041-0000-4000-8000-0000000000e2' and resolved_at is null) then 'PASS' else 'FAIL' end, '');
  select count(*) into n_open from platform_alerts where resolved_at is null;
  insert into t41 values (5,'exactly one open row per condition per subject',
    case when n_open = (select open_before from t41_base) + 2 then 'PASS' else 'FAIL' end, n_open::text);
end $$;

-- ============================================ 2. clearing and recurring
update billing_events set status = 'applied', applied_at = now()
 where id = '00000041-0000-4000-8000-0000000000e2';

do $$
declare r jsonb; first_id uuid;
begin
  r := fn_admin_scan();
  insert into t41 values (6,'a condition that clears resolves its alert -- the row stays',
    case when (r->>'resolved')::int = 1
          and exists (select 1 from platform_alerts where kind='billing_stuck'
                       and subject='00000041-0000-4000-8000-0000000000e2' and resolved_at is not null
                       and resolution like 'cleared:%') then 'PASS' else 'FAIL' end, r::text);
  select id into first_id from platform_alerts where kind='billing_stuck' and subject='00000041-0000-4000-8000-0000000000e2';

  -- it recurs
  update billing_events set status = 'failed_transient', attempts = 5
   where id = '00000041-0000-4000-8000-0000000000e2';
  r := fn_admin_scan();
  insert into t41 values (7,'a recurring condition opens a NEW row; the resolved one is untouched',
    case when (r->>'opened')::int = 1
          and (select count(*) from platform_alerts where kind='billing_stuck'
                 and subject='00000041-0000-4000-8000-0000000000e2') = 2
          and (select resolved_at is not null from platform_alerts where id = first_id) then 'PASS' else 'FAIL' end, r::text);
end $$;

-- ============================================ 3. founder slots
do $$
declare r jsonb;
begin
  -- take 91 slots: 9 free -> low
  update founder_slots set account_id = (select account_id from t41_ids), claimed_at = now()
   where seq = 1;
  -- the unique constraint allows one account per slot; mark the rest reserved-and-expired-with-an-account
  -- is not representable, so simulate exhaustion the way the data can actually look:
  -- assign distinct throwaway accounts
  insert into accounts (id, name)
  select ('00000041-0000-4000-8000-0000000001'||lpad(to_hex(g),2,'0'))::uuid, 'slot filler '||g
    from generate_series(2, 91) g;
  update founder_slots f
     set account_id = ('00000041-0000-4000-8000-0000000001'||lpad(to_hex(f.seq),2,'0'))::uuid,
         claimed_at = now()
   where f.seq between 2 and 91;
  r := fn_admin_scan();
  insert into t41 values (8,'nine free slots raise founder_slots_low',
    case when exists (select 1 from platform_alerts where kind='founder_slots_low' and resolved_at is null
                       and (detail->>'free')::int = 9) then 'PASS' else 'FAIL' end, r::text);

  insert into accounts (id, name)
  select ('00000041-0000-4000-8000-0000000001'||lpad(to_hex(g),2,'0'))::uuid, 'slot filler '||g
    from generate_series(92, 100) g;
  update founder_slots f
     set account_id = ('00000041-0000-4000-8000-0000000001'||lpad(to_hex(f.seq),2,'0'))::uuid,
         claimed_at = now()
   where f.seq between 92 and 100;
  r := fn_admin_scan();
  insert into t41 values (9,'no free slot raises founder_slots_exhausted and resolves the low warning',
    case when exists (select 1 from platform_alerts where kind='founder_slots_exhausted' and severity='critical' and resolved_at is null)
          and not exists (select 1 from platform_alerts where kind='founder_slots_low' and resolved_at is null)
         then 'PASS' else 'FAIL' end, r::text);
end $$;

-- ============================================ 4. the admin's side
do $$
declare v jsonb; msg text; rid uuid; res jsonb; c_scan text; c_read text; a_alerts text;
begin
  select id into rid from platform_alerts where kind='billing_failed_permanent' and resolved_at is null limit 1;

  perform set_config('request.jwt.claim.sub','00000041-0000-4000-8000-000000000001', true);
  set local role authenticated;
  v := fn_admin_alerts(true);
  msg := 'OK';
  begin perform fn_admin_resolve_alert(rid, '   '); exception when others then msg := sqlstate; end;
  res := fn_admin_resolve_alert(rid, 'Mapped the plan code and re-delivered the event.');
  c_scan := 'RAN';
  begin perform fn_admin_scan(); exception when others then c_scan := sqlstate; end;
  c_read := 'READ';
  begin perform * from platform_alerts; exception when others then c_read := sqlstate; end;
  reset role;

  perform set_config('request.jwt.claim.sub','00000041-0000-4000-8000-000000000002', true);
  set local role authenticated;
  a_alerts := 'OK';
  begin perform fn_admin_alerts(true); exception when others then a_alerts := sqlstate; end;
  reset role;
  perform set_config('request.jwt.claim.sub','', true);

  insert into t41 values (10,'the admin reads open alerts, most severe first',
    case when (v->>'open')::int >= 2 and (v->'rows'->0->>'severity') = 'critical' then 'PASS' else 'FAIL' end,
    'open '||(v->>'open')||', critical '||(v->>'critical'));
  insert into t41 values (11,'resolving without a note is refused',
    case when msg='22023' then 'PASS' else 'FAIL' end, msg);
  insert into t41 values (12,'resolving with a note records who and what',
    case when res->>'resolution' like 'Mapped%' and res->>'resolved_by'='00000041-0000-4000-8000-000000000001'
          and res->>'resolved_at' is not null then 'PASS' else 'FAIL' end, res->>'resolution');
  insert into t41 values (13,'even the admin cannot run the scan as a client',
    case when c_scan='42501' then 'PASS' else 'FAIL' end, c_scan);
  insert into t41 values (14,'nor read the table directly',
    case when c_read='42501' then 'PASS' else 'FAIL' end, c_read);
  insert into t41 values (15,'a customer is refused the alerts',
    case when a_alerts='42501' then 'PASS' else 'FAIL' end, a_alerts);

  -- the admin's resolution survives the next scan even though the condition persists
  perform fn_admin_scan();
  insert into t41 values (16,'an admin-resolved alert is not reopened in place; the persisting condition gets a new row',
    case when (select resolved_at is not null from platform_alerts where id = rid)
          and (select count(*) from platform_alerts where kind='billing_failed_permanent'
                 and subject='00000041-0000-4000-8000-0000000000e1' and resolved_at is null) = 1
         then 'PASS' else 'FAIL' end, '');
end $$;

-- ============================================ 5. nothing else moved
insert into t41 values (17,'117 policies, unchanged',
  case when (select count(*) from pg_policies where schemaname='public')=117 then 'PASS' else 'FAIL' end,
  (select count(*)::text from pg_policies where schemaname='public'));
insert into t41 values (18,'the mailer''s queue is the unnotified open rows',
  case when (select count(*) from platform_alerts where notified_at is null and resolved_at is null) >= 2 then 'PASS' else 'FAIL' end,
  (select count(*)::text from platform_alerts where notified_at is null and resolved_at is null));

select n, check_name, verdict, left(detail,70) as detail from t41 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t41;

rollback;
