-- ============================================================================
-- MENU MASTER NG — the decisive check
--
-- READ ONLY. One SELECT. Nothing is inserted, updated, deleted or created.
--
-- Does each test user's CURRENT auth id still have a membership row?
-- If auth user A was deleted and re-created while we were fixing the
-- sign-in problem, she came back with a new UUID and migration 0001's
--   user_id uuid not null references auth.users(id) on delete cascade
-- silently removed her from her own account.
-- ============================================================================

select
  u.email,
  u.id::text                                  as current_auth_id,
  coalesce(m.role::text, '>>> NO MEMBERSHIP') as membership_role,
  coalesce(a.name, '>>> NO ACCOUNT')          as account_name,
  u.created_at
from auth.users u
left join memberships m on m.user_id = u.id
left join accounts   a on a.id = m.account_id
where u.email ilike '%boundary%'
order by u.email;
