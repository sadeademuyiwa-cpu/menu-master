-- ============================================================================
-- READ-ONLY DIAGNOSTIC — why can the three test users not sign in?
-- Run in the Supabase SQL Editor. Reads only. Changes nothing.
--
-- to_jsonb() is used so this cannot fail if your GoTrue version names a column
-- differently -- it reports whatever is actually there.
-- ============================================================================

select
  u.email,

  -- Can this user sign in with a password at all?
  case when coalesce(to_jsonb(u) ->> 'encrypted_password', '') = ''
       then 'NO PASSWORD SET'  else 'password present' end            as password_state,

  -- Password grant requires an email identity row. Users made by some routes
  -- (invite, magic link, direct SQL insert) can end up without one.
  (select count(*) from auth.identities i where i.user_id = u.id)      as identity_rows,

  case when (to_jsonb(u) ->> 'email_confirmed_at') is null
       then 'NOT CONFIRMED' else 'confirmed' end                       as confirm_state,

  coalesce(to_jsonb(u) ->> 'banned_until', '-')                        as banned_until,
  coalesce(to_jsonb(u) ->> 'deleted_at',   '-')                        as deleted_at,
  coalesce(to_jsonb(u) ->> 'aud',   '-')                               as aud,
  coalesce(to_jsonb(u) ->> 'role',  '-')                               as role,

  -- Hidden whitespace or capitals would make the sign-in email not match.
  case when u.email <> lower(btrim(u.email))
       then 'MISMATCH: "' || u.email || '"' else 'clean' end           as email_hygiene

from auth.users u
where u.email ilike '%boundary%'
   or u.email ilike '%owner%'
   or u.email ilike '%cashier%'
order by u.email;
