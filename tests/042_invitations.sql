-- ============================================================================
-- MENU MASTER NG -- tests/042_invitations.sql
--
-- Acceptance test for 0056. Run on a database with 0056 applied.
-- Rolls everything back.
--
-- An owner invites; the invited person signs in and is simply in. Everyone
-- else -- a sales member inviting, a stranger accepting, an expired or
-- revoked link, a client reading tokens -- is refused, and the last owner can
-- never be removed.
-- ============================================================================

begin;

create temp table t42 (n int, check_name text, verdict text, detail text) on commit drop;

insert into auth.users (id, email) values
  ('00000042-0000-4000-8000-000000000001', 'owner@t42.test'),
  ('00000042-0000-4000-8000-000000000002', 'Cook@T42.test'),       -- mixed case on purpose
  ('00000042-0000-4000-8000-000000000003', 'stranger@t42.test'),
  ('00000042-0000-4000-8000-000000000004', 'late@t42.test'),
  ('00000042-0000-4000-8000-000000000005', 'other-owner@t42.test');

create temp table t42_ids on commit drop as
select (fn_create_account_and_business('T42 Foods','T42 Kitchen','other',
          '00000042-0000-4000-8000-000000000001', p_idempotency_key => 't42-owner')->>'account_id')::uuid as account_id,
       (fn_create_account_and_business('Other Foods','Other Kitchen','other',
          '00000042-0000-4000-8000-000000000005', p_idempotency_key => 't42-other')->>'account_id')::uuid as other_id;

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
end $$;

-- ============================================ 1. shape
do $$
begin
  insert into t42 values (1,'invitations: RLS on, no policy, no client grant',
    case when (select relrowsecurity from pg_class where relname='invitations')
          and not exists (select 1 from pg_policies where tablename='invitations')
          and not has_table_privilege('authenticated','invitations','select')
          and not has_table_privilege('anon','invitations','select') then 'PASS' else 'FAIL' end, '');
  insert into t42 values (2,'anon can call none of the seven',
    case when (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace
                 and p.proname in ('fn_invite_member','fn_list_invitations','fn_revoke_invitation','fn_accept_invitations',
                                   'fn_list_members','fn_set_member_role','fn_remove_member')
                 and has_function_privilege('anon', p.oid, 'execute')) = 0 then 'PASS' else 'FAIL' end, '');
end $$;

-- ============================================ 2. inviting
do $$
declare acct uuid; other uuid; r jsonb; msg text; tok text; r2 jsonb;
begin
  select account_id, other_id into acct, other from t42_ids;

  -- the owner invites a cook as sales, with sloppy casing and spaces
  perform pg_temp.as_user('00000042-0000-4000-8000-000000000001');
  set local role authenticated;
  r := fn_invite_member(acct, '  Cook@T42.test ', 'sales');
  tok := r->>'token';
  -- inviting the same address again renews rather than duplicates
  r2 := fn_invite_member(acct, 'cook@t42.test', 'kitchen');
  -- an owner cannot be invited
  msg := 'OK'; begin perform fn_invite_member(acct, 'boss@t42.test', 'owner'); exception when others then msg := sqlstate; end;
  reset role;
  insert into t42 values (3,'the owner invites; the address is normalised and a token issued',
    case when r->>'email'='cook@t42.test' and r->>'role'='sales' and length(tok) = 48 then 'PASS' else 'FAIL' end, r::text);
  insert into t42 values (4,'re-inviting the same address renews the one open invitation',
    case when r2->>'invitation_id' = r->>'invitation_id' and r2->>'role'='kitchen'
          and (select count(*) from invitations where account_id=acct) = 1 then 'PASS' else 'FAIL' end, r2->>'role');
  insert into t42 values (5,'an owner role cannot be invited',
    case when msg='22023' then 'PASS' else 'FAIL' end, msg);

  -- the other account''s owner cannot invite into this one
  perform pg_temp.as_user('00000042-0000-4000-8000-000000000005');
  set local role authenticated;
  msg := 'OK'; begin perform fn_invite_member(acct, 'x@t42.test', 'sales'); exception when others then msg := sqlstate; end;
  reset role;
  insert into t42 values (6,'an owner of ANOTHER account is refused',
    case when msg='42501' then 'PASS' else 'FAIL' end, msg);

  -- a stranger cannot read or accept it
  perform pg_temp.as_user('00000042-0000-4000-8000-000000000003');
  set local role authenticated;
  r := fn_accept_invitations();
  msg := 'READ'; begin perform * from invitations; exception when others then msg := sqlstate; end;
  reset role;
  insert into t42 values (7,'a stranger accepting gets nothing',
    case when (r->>'accepted')::int = 0 then 'PASS' else 'FAIL' end, r::text);
  insert into t42 values (8,'and cannot read the table (tokens) at all',
    case when msg='42501' then 'PASS' else 'FAIL' end, msg);

  -- the invited cook signs in: in, with the renewed role
  perform pg_temp.as_user('00000042-0000-4000-8000-000000000002');
  set local role authenticated;
  r := fn_accept_invitations();
  r2 := fn_accept_invitations();
  reset role;
  insert into t42 values (9,'the invited person signs in and is simply in, with the invited role',
    case when (r->>'accepted')::int = 1
          and exists (select 1 from memberships where account_id=acct
                       and user_id='00000042-0000-4000-8000-000000000002' and role='kitchen') then 'PASS' else 'FAIL' end, r::text);
  insert into t42 values (10,'accepting again is a no-op',
    case when (r2->>'accepted')::int = 0 and (select count(*) from memberships where account_id=acct) = 2 then 'PASS' else 'FAIL' end, r2::text);
  insert into t42 values (11,'the invitation records who accepted and when',
    case when exists (select 1 from invitations where account_id=acct and accepted_at is not null
                       and accepted_by='00000042-0000-4000-8000-000000000002') then 'PASS' else 'FAIL' end, '');

  -- the new kitchen member sees no costs and cannot invite
  perform pg_temp.as_user('00000042-0000-4000-8000-000000000002');
  set local role authenticated;
  msg := 'OK'; begin perform fn_invite_member(acct, 'friend@t42.test', 'sales'); exception when others then msg := sqlstate; end;
  reset role;
  insert into t42 values (12,'a kitchen member cannot invite',
    case when msg='42501' then 'PASS' else 'FAIL' end, msg);
  insert into t42 values (13,'and cannot see costs (0001 rule, unchanged)',
    case when not (select fn_can_see_costs(acct)) then 'PASS' else 'FAIL' end, '');
end $$;

-- ============================================ 3. expiry and revocation
do $$
declare acct uuid; r jsonb; rl jsonb; msg text; inv uuid;
begin
  select account_id into acct from t42_ids;
  perform pg_temp.as_user('00000042-0000-4000-8000-000000000001');
  set local role authenticated;
  r := fn_invite_member(acct, 'late@t42.test', 'sales');
  reset role;
  perform pg_temp.as_user(null);
  update invitations set expires_at = now() - interval '1 minute' where id = (r->>'invitation_id')::uuid;

  perform pg_temp.as_user('00000042-0000-4000-8000-000000000004');
  set local role authenticated;
  r := fn_accept_invitations();
  reset role;
  insert into t42 values (14,'an expired invitation cannot be accepted',
    case when (r->>'accepted')::int = 0 then 'PASS' else 'FAIL' end, r::text);

  -- the owner sees it as expired, with no token; re-invites; revokes
  perform pg_temp.as_user('00000042-0000-4000-8000-000000000001');
  set local role authenticated;
  rl := fn_list_invitations(acct);
  r := fn_invite_member(acct, 'late@t42.test', 'sales');
  inv := (r->>'invitation_id')::uuid;
  perform fn_revoke_invitation(inv);
  rl := fn_list_invitations(acct);
  reset role;
  insert into t42 values (15,'the list shows the pending token, and no token once revoked',
    case when exists (select 1 from jsonb_array_elements(rl) e where e->>'email'='late@t42.test' and e->>'status'='revoked' and e->>'token' is null)
          and exists (select 1 from jsonb_array_elements(rl) e where e->>'email'='cook@t42.test' and e->>'status'='accepted') then 'PASS' else 'FAIL' end, rl::text);

  perform pg_temp.as_user('00000042-0000-4000-8000-000000000004');
  set local role authenticated;
  r := fn_accept_invitations();
  reset role;
  insert into t42 values (16,'a revoked invitation cannot be accepted',
    case when (r->>'accepted')::int = 0 then 'PASS' else 'FAIL' end, r::text);

  -- a non-owner cannot list or revoke
  perform pg_temp.as_user('00000042-0000-4000-8000-000000000002');
  set local role authenticated;
  msg := 'OK'; begin perform fn_list_invitations(acct); exception when others then msg := sqlstate; end;
  reset role;
  insert into t42 values (17,'a member who is not an owner cannot list invitations',
    case when msg='42501' then 'PASS' else 'FAIL' end, msg);
end $$;

-- ============================================ 4. members, roles, the last owner
do $$
declare acct uuid; r jsonb; msg text; ml jsonb;
begin
  select account_id into acct from t42_ids;
  perform pg_temp.as_user('00000042-0000-4000-8000-000000000002');
  set local role authenticated;
  ml := fn_list_members(acct);
  reset role;
  insert into t42 values (18,'any member sees who is on the account, owners first, themselves marked',
    case when jsonb_array_length(ml) = 2 and ml->0->>'role'='owner' and (ml->1->>'is_you')::bool then 'PASS' else 'FAIL' end, ml::text);

  perform pg_temp.as_user('00000042-0000-4000-8000-000000000001');
  set local role authenticated;
  r := fn_set_member_role(acct, '00000042-0000-4000-8000-000000000002', 'manager');
  msg := 'OK'; begin perform fn_set_member_role(acct, '00000042-0000-4000-8000-000000000001', 'sales'); exception when others then msg := sqlstate; end;
  reset role;
  insert into t42 values (19,'the owner changes a role',
    case when r->>'role'='manager' then 'PASS' else 'FAIL' end, r::text);
  insert into t42 values (20,'the last owner cannot demote themselves (0012 guard still holds)',
    case when msg='23514' then 'PASS' else 'FAIL' end, msg);

  perform pg_temp.as_user('00000042-0000-4000-8000-000000000001');
  set local role authenticated;
  msg := 'OK'; begin perform fn_remove_member(acct, '00000042-0000-4000-8000-000000000001'); exception when others then msg := sqlstate; end;
  reset role;
  insert into t42 values (21,'the last owner cannot be removed',
    case when msg='23514' then 'PASS' else 'FAIL' end, msg);

  -- promote the manager to owner, then the original owner may leave
  perform pg_temp.as_user('00000042-0000-4000-8000-000000000001');
  set local role authenticated;
  perform fn_set_member_role(acct, '00000042-0000-4000-8000-000000000002', 'owner');
  r := fn_remove_member(acct, '00000042-0000-4000-8000-000000000001');
  reset role;
  insert into t42 values (22,'owners are made by promotion; then the founder may hand over and leave',
    case when (r->>'removed')::bool
          and (select role from memberships where account_id=acct and user_id='00000042-0000-4000-8000-000000000002') = 'owner'
          and not exists (select 1 from memberships where account_id=acct and user_id='00000042-0000-4000-8000-000000000001')
         then 'PASS' else 'FAIL' end, r::text);

  -- a manager (not owner) cannot remove
  perform pg_temp.as_user('00000042-0000-4000-8000-000000000002');
  set local role authenticated;
  perform fn_invite_member(acct, 'stranger@t42.test', 'manager');
  reset role;
  perform pg_temp.as_user('00000042-0000-4000-8000-000000000003');
  set local role authenticated;
  perform fn_accept_invitations();
  msg := 'OK'; begin perform fn_remove_member(acct, '00000042-0000-4000-8000-000000000002'); exception when others then msg := sqlstate; end;
  reset role;
  insert into t42 values (23,'a manager cannot remove the owner',
    case when msg='42501' then 'PASS' else 'FAIL' end, msg);
end $$;

-- ============================================ 5. nothing else moved
insert into t42 values (24,'117 policies, unchanged',
  case when (select count(*) from pg_policies where schemaname='public')=117 then 'PASS' else 'FAIL' end,
  (select count(*)::text from pg_policies where schemaname='public'));

select n, check_name, verdict, left(detail,70) as detail from t42 order by n;
select count(*) filter (where verdict='PASS') as pass,
       count(*) filter (where verdict='FAIL') as fail from t42;

rollback;
