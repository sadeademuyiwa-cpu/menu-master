-- ============================================================================
-- MENU MASTER NG — why do B and cashier fail to sign in when A succeeds?
--
-- DISPOSABLE PROJECT ONLY. READ ONLY: one SELECT. No writes.
--
-- Owner A signing in with the same password rules out the URL, the anon key
-- and the password string. This compares the three rows side by side so the
-- column that differs is visible.
--
-- No password hash is shown -- only whether one exists and which algorithm
-- prefix it carries.
-- ============================================================================

select
  u.email,

  -- GoTrue refuses an unconfirmed address with the SAME 400 invalid_credentials
  -- it returns for a wrong password. This is the most likely difference.
  case when to_jsonb(u) ->> 'email_confirmed_at' is null
       then '>>> NOT CONFIRMED' else 'confirmed' end            as email_state,

  case when coalesce(to_jsonb(u) ->> 'encrypted_password','') = ''
       then '>>> NO PASSWORD'
       else 'set (' || left(to_jsonb(u) ->> 'encrypted_password', 4) || ')'
  end                                                            as password_state,

  case when to_jsonb(u) ->> 'banned_until' is not null
       then '>>> BANNED' else '-' end                            as banned,
  case when to_jsonb(u) ->> 'deleted_at' is not null
       then '>>> DELETED' else '-' end                           as deleted,

  coalesce(to_jsonb(u) ->> 'last_sign_in_at', 'never')           as last_sign_in,
  coalesce(to_jsonb(u) ->> 'aud', '-')                           as aud,
  coalesce(to_jsonb(u) ->> 'role', '-')                          as role,
  coalesce(to_jsonb(u) -> 'raw_app_meta_data' ->> 'provider','-') as provider,
  to_jsonb(u) ->> 'created_at'                                   as created_at

from auth.users u
where u.email ilike '%boundary%'
order by u.email;
