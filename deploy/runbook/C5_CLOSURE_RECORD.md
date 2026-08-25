# C5 — CLOSED (2026-08-25)

Removal of the tenant left behind when the C10 acceptance test committed
instead of rolling back, and removal of the two disposable auth users created
for that test.

**Status: CLOSED. Do not rerun `C5_CLEANUP.sql`. Do not rerun
`C5_POST_CLEANUP.sql` — see section 4.**

---

## 1. What was executed

| Step | Artefact | sha256 | Result |
|---|---|---|---|
| 1 | `C5_TRIGGER_AUTHORITY.sql` | `e040f682122356edccf667e3059571e536d8213418557be45b2a65a76f99551f` | 7 GO, 0 STOP |
| 2 | `C5_CLEANUP.sql` (7,083 bytes) | `9ae47ba62f795b50c5eb979641d1a07178d3cced02971c707cf3e77bfab1be06` | committed, no error |
| 3 | Supabase Dashboard → Authentication → Users | — | two disposable users deleted, `auth.users` now **5** |

Superseded and not to be run: `9b41933ef7b333a00ea9d9c2c47e071cf34b3692c6632fcb95a1eae169820c88`.

Scope removed: account `59687f01-5954-4705-9a7c-32f2d5cbf669` and its 207
dependent rows, via `ON DELETE CASCADE` across all 27 account-level FKs, with
`trg_memberships_last_owner` disabled and re-enabled inside the same
transaction.

## 2. Why the commit is itself the evidence

`C5_CLEANUP.sql` ends with a `DO` block containing assertions that run *before*
`COMMIT`. Every one of them raises and aborts the transaction on failure; none
is silent. Because the transaction committed without error, all of the
following were true at commit time and require no separate proof:

| Assertion | Proven at commit |
|---|---|
| `trg_memberships_last_owner` present and `tgenabled='O'` | guard restored |
| zero rows in `accounts`, `businesses`, `memberships`, `locations`, `business_settings`, `channels`, `ingredients`, `ingredient_categories`, `subscriptions`, `onboarding_requests` | tenant fully gone |
| `units` = 45 | global reference rows intact (they are `account_id is null`, so the cascade could not reach them) |
| `catalog_ingredients` 180, `catalog_categories` 16, `plans` 3, `plan_features` 12 | reference data unchanged |
| 40 `fn_*` functions · 44 relations · 93 policies | schema shape unchanged |
| `fn_create_account_and_business` with 9 arguments present | the 0020 RPC survived |
| `auth.users` = 7 | **no auth user was removed by SQL** |

The operator then confirmed visually that Authentication shows exactly **5**
users, which accounts for the two Dashboard deletions and no others.

## 3. Confirmation that `auth.users` was never written by SQL

`C5_CLEANUP.sql` references `auth.users` three times — a `join` in the preflight
scope query and two `count(*)` calls in the self-check. It contains no
`insert into auth.`, `update auth.` or `delete from auth.`. The two disposable
users were removed through the Dashboard only, after tenant cleanup had already
committed and self-verified.

## 4. `C5_POST_CLEANUP.sql` is spent — do not run it now

`aa17e267ec4d984f7010ebd15ac4da0fb93e2e40fc24eac33a63d368388120d9`, 9,372 bytes.

It was written to run **in the window between the cleanup commit and the
Dashboard deletions**, and its section 5 asserts `auth.users is STILL 7`. That
window has closed: `auth.users` is now 5. Run today it would emit a **STOP on
that row** — a false alarm, not a defect in production. It is kept unmodified so
its published checksum stays truthful, and it is recorded here as **spent**.

Sections 1–4 of that script are in any case subsumed by the in-transaction
assertions in section 2 above, which are strictly stronger: they could not have
been bypassed, because failing any of them would have aborted the delete.

## 5. Production state at C5 closure

| | Value |
|---|---|
| `auth.users` | **5** — the five pre-existing users, untouched throughout |
| Tenant rows (accounts and all descendants) | **0** |
| Reference data | `units` 45 · `catalog_ingredients` 180 · `catalog_categories` 16 · `plans` 3 · `plan_features` 12 |
| Schema | 40 `fn_*` · 44 relations · 93 policies |
| Onboarding RPC | `fn_create_account_and_business`, 9 arguments, idempotent (0020) |
| Signup hook | `handle_new_user` neutralised to a no-op (0019c); `on_auth_user_created` still present and enabled |
| Guard | `trg_memberships_last_owner` enabled |

## 6. Still open after C5

These are recorded, not resolved by C5:

1. **The seventh auth user `2b61fc84-7d06-4aa0-b7b5-d5bf7846ec5f` was never
   explained.** It held no tenant data. It was one of the two disposable users
   deleted through the Dashboard, so it no longer exists, but why it existed
   was not established.
2. **The five pre-existing users still hold no tenant.** They remain protected
   and unaltered. Whether they are real prospects or the operator's own test
   accounts is still unknown, and nothing may be assumed about them.
3. **Email confirmation behaviour was never settled** — the test user was
   created without an Auto Confirm option being available.
