# DEPLOYMENT RUNBOOK — 0056 (staff invitations)

> ## ⛔ NOT AUTHORISED UNTIL YOU RUN IT. Nothing here has touched production.

Expected starting state: **0055 applied**, 117 policies, 85 `fn_*` functions.
Part B of `docs/PLAN_LAUNCH_PLUS.md`.

## What changes

| | |
|---|---|
| `invitations` | new table. RLS on, **no policy**, no client grant: the token is a credential and no client role reads the table |
| 7 functions | `fn_invite_member`, `fn_list_invitations`, `fn_revoke_invitation` (owner only); `fn_accept_invitations` (the signed-in user, matched by their own login email); `fn_list_members` (any member); `fn_set_member_role`, `fn_remove_member` (owner only; the 0012 last-owner trigger still guards) |
| Policies | 117 → **117** |
| `fn_*` | 85 → 92 |
| Customer rows | none |

Owner decisions applied: a **manager may not invite** (owner only); **owners are
never invited** — an invitation is a link in an inbox, not a strong enough
credential to hand over an account; promote from the People screen instead.

## Order of operations

| # | Artefact | Where | Writes? |
|---|---|---|---|
| 1 | `PRE_DEPLOY_0056.sql` | SQL Editor | no |
| 2 | `migrations/proposed/0056_invitations.sql` | **psql only** | yes |
| 3 | `POST_VERIFY_0056.sql` | SQL Editor | no |
| — | `migrations/rollbacks/0056_rollback.sql` | psql, only if 3 fails | yes |

```
psql "<session-pooler connection string>" --single-transaction -v ON_ERROR_STOP=1 \
     -f migrations/proposed/0056_invitations.sql
```

Expect **PRE 6/6**, `NOTICE: 0056 OK: …`, **POST 7/7**. Same transaction guard
as 0049–0055; it refuses the SQL Editor. After POST passes, `git mv` the file
from `proposed/` to `migrations/`.

The app's `/settings/people` page and the sign-in hook that accepts
invitations ship in the same deploy; both say "not available yet" harmlessly
if the page reaches production before the migration does.

## Rollback

Drops the seven functions and the table. Memberships already created by
accepting an invitation are ordinary memberships and are **kept** — removing
a person is an owner's decision, not a rollback's. Byte-faithful to 0055.

## Rehearsal results

| Item | Result |
|---|---|
| apply / `tests/042` / rollback / re-apply | `OK` · **24/24** · `OK` (fingerprint returns to 0055) · `OK` |
