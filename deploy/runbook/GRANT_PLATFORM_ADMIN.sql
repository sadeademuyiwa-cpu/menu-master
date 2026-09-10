-- ============================================================================
-- GRANT_PLATFORM_ADMIN.sql            WRITES ONE ROW. Run as the operator.
--
-- Makes one existing login a platform administrator. The repository never
-- states who: replace the email below before running. Safe in the SQL
-- Editor -- it is one INSERT and refuses if the login does not exist.
--
-- To revoke later:
--   update platform_admins set revoked_at = now()
--    where user_id = (select id from auth.users where lower(email) = lower('<email>'));
-- ============================================================================
do $$
declare v_user uuid; v_email text := 'REPLACE_WITH_THE_ADMIN_LOGIN_EMAIL';
begin
  if v_email = 'REPLACE_WITH_THE_ADMIN_LOGIN_EMAIL' then
    raise exception 'Edit v_email first.';
  end if;
  select id into v_user from auth.users where lower(email) = lower(v_email);
  if v_user is null then
    raise exception 'No login with the email %. The person must sign up first.', v_email;
  end if;
  insert into platform_admins (user_id, granted_by, reason)
  values (v_user, null, 'first platform administrator, granted by the owner at deploy of 0053')
  on conflict (user_id) do update set revoked_at = null, granted_at = now(),
    reason = 'platform administrator, re-granted by the owner';
  raise notice 'platform admin granted: % (%)', v_email, v_user;
end
$$;

select u.email, a.granted_at, a.revoked_at, a.reason
  from platform_admins a join auth.users u on u.id = a.user_id
 order by a.granted_at;
