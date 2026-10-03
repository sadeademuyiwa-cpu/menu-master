-- ============================================================================
-- MENU MASTER NG -- tests/044_trial_reminders.sql
--
-- Acceptance test for 0058. Run on a database with 0058 applied.
-- Rolls everything back.
--
-- Each trial gets the right reminder at the right moment, once; a paying
-- account is never reminded; and no client can see owners' emails or send.
-- ============================================================================

begin;

create temp table t44 (n int, check_name text, verdict text, detail text) on commit drop;

insert into auth.users (id, email) values
  ('00000044-0000-4000-8000-000000000001', 'three@t44.test'),
  ('00000044-0000-4000-8000-000000000002', 'tomorrow@t44.test'),
  ('00000044-0000-4000-8000-000000000003', 'ended@t44.test'),
  ('00000044-0000-4000-8000-000000000004', 'early@t44.test'),
  ('00000044-0000-4000-8000-000000000005', 'paid@t44.test'),
  ('00000044-0000-4000-8000-000000000006', 'longgone@t44.test');

create temp table t44_acc (who text, account_id uuid) on commit drop;
insert into t44_acc
select w, (fn_create_account_and_business('T44 '||w, 'T44 '||w||' Kitchen', 'other', u::uuid,
                                          p_idempotency_key => 't44-'||w)->>'account_id')::uuid
  from (values ('three',    '00000044-0000-4000-8000-000000000001'),
               ('tomorrow', '00000044-0000-4000-8000-000000000002'),
               ('ended',    '00000044-0000-4000-8000-000000000003'),
               ('early',    '00000044-0000-4000-8000-000000000004'),
               ('paid',     '00000044-0000-4000-8000-000000000005'),
               ('longgone', '00000044-0000-4000-8000-000000000006')) v(w, u);

-- put each trial at its moment
update subscriptions s set current_period_end = now() + case a.who
         when 'three'    then interval '2 days 12 hours'
         when 'tomorrow' then interval '10 hours'
         when 'ended'    then interval '-1 day'
         when 'early'    then interval '9 days'
         when 'paid'     then interval '1 day'
         when 'longgone' then interval '-20 days' end
  from t44_acc a where a.account_id = s.account_id;
update subscriptions s set status = 'active', current_period_end = now() + interval '20 days'
  from t44_acc a where a.account_id = s.account_id and a.who = 'paid';

create temp table t44_due on commit drop as
select a.who, d.kind, d.owner_email, d.business_name
  from fn_trial_reminders_due() d join t44_acc a on a.account_id = d.account_id;

-- ============================================ 1. the right reminder, the right moment
do $$
begin
  insert into t44 values (1,'three days out: "ends in 3 days"',
    case when (select kind from t44_due where who='three') = 'ends_in_3_days' then 'PASS' else 'FAIL' end,
    coalesce((select kind from t44_due where who='three'), 'none'));
  insert into t44 values (2,'within a day: "ends tomorrow"',
    case when (select kind from t44_due where who='tomorrow') = 'ends_tomorrow' then 'PASS' else 'FAIL' end,
    coalesce((select kind from t44_due where who='tomorrow'), 'none'));
  insert into t44 values (3,'ended yesterday and unpaid: "ended"',
    case when (select kind from t44_due where who='ended') = 'ended' then 'PASS' else 'FAIL' end,
    coalesce((select kind from t44_due where who='ended'), 'none'));
  insert into t44 values (4,'nine days to go: nothing yet',
    case when not exists (select 1 from t44_due where who='early') then 'PASS' else 'FAIL' end, '');
  insert into t44 values (5,'a paying account is never reminded',
    case when not exists (select 1 from t44_due where who='paid') then 'PASS' else 'FAIL' end, '');
  insert into t44 values (6,'a trial that ended weeks ago is left alone',
    case when not exists (select 1 from t44_due where who='longgone') then 'PASS' else 'FAIL' end, '');
  insert into t44 values (7,'each comes with the owner''s email and the business name',
    case when (select owner_email from t44_due where who='three') = 'three@t44.test'
          and (select business_name from t44_due where who='three') = 'T44 three Kitchen'
         then 'PASS' else 'FAIL' end,
    coalesce((select owner_email||' / '||business_name from t44_due where who='three'), 'none'));
end $$;

-- ============================================ 2. once each, ever
do $$
declare first_rec bool; second_rec bool; v_left int;
begin
  first_rec  := fn_record_trial_reminder((select account_id from t44_acc where who='three'), 'ends_in_3_days', 'three@t44.test');
  second_rec := fn_record_trial_reminder((select account_id from t44_acc where who='three'), 'ends_in_3_days', 'three@t44.test');
  insert into t44 values (8,'recording a reminder succeeds once and is a no-op after',
    case when first_rec and not second_rec then 'PASS' else 'FAIL' end, first_rec||'/'||second_rec);
  select count(*) into v_left from fn_trial_reminders_due() d
   where d.account_id = (select account_id from t44_acc where who='three');
  insert into t44 values (9,'a recorded reminder is not owed again',
    case when v_left = 0 then 'PASS' else 'FAIL' end, v_left::text);

  -- after "ended" is sent, a trial pushed back into its last day is not told "ending"
  perform fn_record_trial_reminder((select account_id from t44_acc where who='ended'), 'ended', 'ended@t44.test');
  update subscriptions set current_period_end = now() + interval '5 hours'
   where account_id = (select account_id from t44_acc where who='ended');
  select count(*) into v_left from fn_trial_reminders_due() d
   where d.account_id = (select account_id from t44_acc where who='ended');
  insert into t44 values (10,'once told it ended, never told it is ending',
    case when v_left = 0 then 'PASS' else 'FAIL' end, v_left::text);
end $$;

-- ============================================ 3. no client can see or send
do $$
declare v_due text; v_rec text; v_read text; v_anon text;
begin
  perform set_config('request.jwt.claim.sub','00000044-0000-4000-8000-000000000001', true);
  set local role authenticated;
  v_due := 'ANSWERED';
  begin perform * from fn_trial_reminders_due(); exception when others then v_due := sqlstate; end;
  v_rec := 'RECORDED';
  begin perform fn_record_trial_reminder(gen_random_uuid(), 'ended', 'x@y.z'); exception when others then v_rec := sqlstate; end;
  v_read := 'READ';
  begin perform * from trial_reminders; exception when others then v_read := sqlstate; end;
  reset role;
  perform set_config('request.jwt.claim.sub','', true);
  set local role anon;
  v_anon := 'ANSWERED';
  begin perform * from fn_trial_reminders_due(); exception when others then v_anon := sqlstate; end;
  reset role;
  insert into t44 values (11,'a signed-in owner cannot list reminders (owners'' emails) -- 42501',
    case when v_due = '42501' then 'PASS' else 'FAIL' end, v_due);
  insert into t44 values (12,'nor record one',
    case when v_rec = '42501' then 'PASS' else 'FAIL' end, v_rec);
  insert into t44 values (13,'nor read the table',
    case when v_read = '42501' then 'PASS' else 'FAIL' end, v_read);
  insert into t44 values (14,'nor can a logged-out caller',
    case when v_anon = '42501' then 'PASS' else 'FAIL' end, v_anon);
end $$;

-- ============================================ 4. nothing else moved
-- 038 proves the 0052 rule only at 0052 (it is era-pinned); this keeps it true
-- at head for everything added since.
do $$
declare v int; v_list text;
begin
  with fk as (
    select c.conrelid::regclass::text as tbl, c.conname, c.conkey
      from pg_constraint c join pg_class r on r.oid=c.conrelid
     where c.contype='f' and r.relnamespace='public'::regnamespace),
  covered as (
    select fk.conname from fk join pg_index i on i.indrelid = fk.tbl::regclass
     where (i.indkey::int2[])[0:array_length(fk.conkey,1)-1] = fk.conkey)
  select count(*), string_agg(conname, ', ') into v, v_list from fk where conname not in (select conname from covered);
  insert into t44 values (16,'every foreign key still has a covering index (the 0052 rule, at head)',
    case when v = 0 then 'PASS' else 'FAIL' end, coalesce(v_list, 'all covered'));
end $$;

insert into t44 values (15,'118 policies, unchanged',
  case when (select count(*) from pg_policies where schemaname='public')=118 then 'PASS' else 'FAIL' end,
  (select count(*)::text from pg_policies where schemaname='public'));

select n, check_name, verdict, left(detail,60) as detail from t44 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t44;

rollback;
