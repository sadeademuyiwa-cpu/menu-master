-- ============================================================================
-- 0056 ROLLBACK: drop the seven member functions and the invitations table.
-- Byte-faithful to 0055. Memberships already created by accepting an
-- invitation are ordinary memberships and are KEPT -- removing a person from
-- an account is an owner's decision, not a rollback's.
-- ============================================================================
drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0056 rollback ABORT: this executor is not honouring transaction control. '
      'Run it with psql --single-transaction.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from pg_class where relname='invitations' and relnamespace='public'::regnamespace) then
    raise exception '0056 rollback: invitations does not exist; 0056 is not applied.';
  end if;
end
$$;

drop function if exists fn_remove_member(uuid, uuid);
drop function if exists fn_set_member_role(uuid, uuid, member_role);
drop function if exists fn_list_members(uuid);
drop function if exists fn_accept_invitations();
drop function if exists fn_revoke_invitation(uuid);
drop function if exists fn_list_invitations(uuid);
drop function if exists fn_invite_member(uuid, text, member_role);
drop table if exists invitations;

do $$
begin
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 85 then
    raise exception '0056 rollback FAILED: fn_* count is %, expected 85.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  raise notice '0056 rollback OK: back at 0055.';
end
$$;
