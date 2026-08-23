-- ============================================================================
-- MENU MASTER NG — reset the two fixture passwords that do not match
--
-- DISPOSABLE PROJECT ONLY. Never run against production.
--
-- Diagnosis (Step 15a): all three users are confirmed and hold a $2a$ bcrypt
-- password, so the addresses are fine and the difference is the password
-- itself. Owner A signs in with 'BoundaryTest2026!'; B and cashier do not.
--
-- Owner A is deliberately EXCLUDED. Her account works; there is no reason to
-- touch it, and re-hashing a working credential only creates a new way to be
-- wrong.
-- ============================================================================

update auth.users
   set encrypted_password = extensions.crypt('BoundaryTest2026!',
                                             extensions.gen_salt('bf'))
 where email in ('ownerb@boundary.test', 'cashierb@boundary.test');

-- ----------------------------------------------------------------------------
-- Verification, without signing in.
--
-- crypt() re-hashes the candidate password using the STORED hash as the salt.
-- If the result equals the stored hash, that password is the one on the
-- account. This proves the fix directly rather than inferring it from a
-- successful login, and it independently confirms the Step 15a diagnosis:
-- owner A should already read `true`.
-- ----------------------------------------------------------------------------

select
  u.email,
  case when to_jsonb(u) ->> 'email_confirmed_at' is null
       then '>>> NOT CONFIRMED' else 'confirmed' end as email_state,
  case when (to_jsonb(u) ->> 'encrypted_password')
            = extensions.crypt('BoundaryTest2026!',
                               to_jsonb(u) ->> 'encrypted_password')
       then 'MATCHES BoundaryTest2026!'
       else '>>> DOES NOT MATCH' end                 as password_check
from auth.users u
where u.email ilike '%boundary%'
order by u.email;
