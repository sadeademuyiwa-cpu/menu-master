# Foreign Function in Production: `public.handle_new_user`

**Status: ANALYSIS AND PROPOSED REMEDIATION. Production unmodified. Part 5 held.**

Found during Part 4 verification: production's `public` schema holds 34
functions — our 33 `fn_*` functions, plus one that no Menu Master migration
creates.

---

## 1. Root cause

Two independent facts collided.

**(a) A foreign signup hook exists on production.**

```
public.handle_new_user   postgres | SECURITY DEFINER | returns trigger
trigger: auth.users → on_auth_user_created (AFTER INSERT)
body:    insert into vendors (id, contact_name) values (new.id, new.ra…)
```

Created by hand or by a Supabase quickstart, not by an extension and not by
this chain. It predates our deployment: C1's audit found no migration markers,
but it never checked for arbitrary functions — **an omission in my audit**, not
a change introduced by C2.

**(b) `0018` operated on every function in `public`.**

```sql
for f in select p.oid::regprocedure from pg_proc p
          where p.pronamespace = 'public'::regnamespace
loop execute format('revoke all on function %s from public, anon', f.sig); end loop;
```

No filter. It would have revoked `PUBLIC` and `anon` execute from
`handle_new_user` — foreign infrastructure this project does not own.

## 2. A second, larger finding: production signup is already broken

`handle_new_user` inserts into **`vendors`**. Verified read-only:

```
vendors in any schema                        >>> DOES NOT EXIST IN ANY SCHEMA
function search_path                         search_path=public
signup status                                >>> ALREADY BROKEN — trigger active, target table missing
existing auth users                          0
```

The trigger is `AFTER INSERT` on `auth.users`, so it runs inside the insert's
transaction. When it fails, **the whole insert fails and signup fails.**

**This is a pre-existing production defect, not one C2 introduced.** It was
true before Part 1 and is true now. `auth.users` holds 0 rows, which is
consistent with nobody having successfully registered.

It also means **Menu Master cannot onboard a single user on this project until
it is resolved** — our `fn_create_account_and_business` requires an
`auth.users` row to exist first.

## 3. Proposed fix — scope `0018` to our own functions

`0018` has **not** been applied to production; it is inside `PART_5`, unrun.
It was fixed in place rather than patched afterwards, so the exposure is never
opened.

```sql
    where p.pronamespace = 'public'::regnamespace
      and p.proname like 'fn\_%'                                    -- ← ours only
      and not exists (select 1 from pg_depend d
                       where d.objid = p.oid and d.deptype = 'e')   -- ← not an extension's
```

Every Menu Master function is named `fn_*` — 33 of 33 on a fully migrated
database, and the only non-`fn_` function in production is the foreign one.

It also now **reports** what it declines to touch:

```
NOTICE: 0018: LEFT UNTOUCHED (not Menu Master functions): handle_new_user
NOTICE: 0018: relations in public NOT created by this chain: <none>
```

Visibility rather than silence: a future foreign object appears in the
deployment record instead of being quietly skipped.

### Objects affected by the revised `0018`

| Object class | Affected | Untouched |
|---|---|---|
| Functions | 33 `fn_*` — `EXECUTE` revoked from `PUBLIC`, `anon` | **`handle_new_user`** and any extension-owned function |
| Tables/views | all in `public` — `anon` reduced to 5 reference tables; `TRUNCATE`/`TRIGGER`/`REFERENCES` removed from `authenticated` | nothing foreign exists today; any that appears is reported |
| Default privileges | revoked for `anon`, `authenticated` | `service_role` untouched |

### Is `handle_new_user` unchanged?

**Yes — byte, privilege and behaviour.** Proven by applying the revised `0018`
to a database carrying a simulated copy:

```
EXECUTE holders BEFORE : anon, authenticated, authenticator, postgres, service_role
EXECUTE holders AFTER  : anon, authenticated, authenticator, postgres, service_role
```

Identical. Its definition, owner, `SECURITY DEFINER` flag and trigger binding
are never referenced by any statement in the migration.

### Verification of the revised `0018`

| Check | Result |
|---|---|
| Full regression | **154/154** |
| `anon` can execute how many `fn_*`? | **0** — our hardening is undiminished |
| Chain applies end to end | yes, all five parts |
| Final `UNGATED` | **0** |
| Final fingerprint | **`8ac70f63e534`** — unchanged from the verified baseline |
| Default privileges after | `none` |

The security outcome is **identical**; only the blast radius shrank.

## 4. Do the two systems conflict?

| | Menu Master | The foreign hook |
|---|---|---|
| Trigger on `auth.users` | **no** | yes, `AFTER INSERT` |
| Entry point | `fn_create_account_and_business`, called by the client after signup | fires automatically inside the signup transaction |
| Writes to | `accounts`, `memberships`, `businesses`, `profiles` | `vendors` |

**No overlap in objects, and no ordering conflict by design** — ours runs after
signup completes, theirs during it.

**But they cannot coexist in the current state**, because the hook aborts every
signup. Ours never gets the chance to run. That is a *dependency* failure, not
a design conflict: fix or remove the hook and the two are independent.

**They can coexist safely** once `vendors` exists, or once the trigger is
removed. Both are decisions for whoever owns that function — **not this
deployment**, and not something to change without your explicit approval.

## 5. Acceptance criteria corrected

| Criterion | Was | Now |
|---|---|---|
| Function count | raw `pg_proc` in `public` (69) | **`fn_*` count = 33**, extension-owned and foreign excluded |
| Part 3 reference data | `plans 3 · plan_features 12` | `plans 0 · plan_features 0` — `0010` seeds them in Part 4 |
| Part 4 reference data | "unchanged" | `plans 3 · plan_features 12` |
| Item 12 | `pg_cron` absent | no scheduled `cron.job` rows |

All four were wrong because they were measured on a local database that does
not model Supabase faithfully. The shim now carries Supabase's default
privileges, but **still puts `pgcrypto` in `public` where Supabase puts it in
`extensions`** — a remaining fidelity gap, recorded.

## 6. Rollback plan

**The revised `0018` has not been applied anywhere.** Rollback of the *change*
is `git revert`; nothing to undo in any database.

If the revised `0018` is applied and must be reversed, there is no automatic
undo — `REVOKE` is committed. Reversal means re-granting deliberately, which
would reopen the `TRUNCATE` exposure and should never be done to "fix" an
unrelated problem.

**`handle_new_user` needs no rollback: it is never modified.**

## 7. Revised Part 5 gate

`PART_5` changed, so its hash changed. Parts 1–4 are untouched and still match
what production already ran.

| Part | SHA256 (first 16) | |
|---|---|---|
| 1–4 | `07d4340996321fb1` / `22a9f74fe548346f` / `0412c4820fabf217` / `96ef886e427a837b` | unchanged, already applied |
| **5** | **`48264bb13b4de435`** | **changed — supersedes `369d881d33f912ba`** |

**GO criteria (unchanged in substance):** markers 21/21 · tables 33 · views 10
· **`fn_*` functions 40** *(not raw 76)* · UNGATED **0** · anon privileges
`SELECT` on the 5 reference tables · default privileges `none` · fingerprint
**`8ac70f63e534`**.

**Additionally required for Part 5:**

- the notice `0018: LEFT UNTOUCHED (not Menu Master functions): handle_new_user`
- `handle_new_user` `EXECUTE` holders identical before and after
- the trigger `on_auth_user_created` still bound to it

**STOP if** `handle_new_user` loses any grant, or the notice does not appear.

## 8. What this does not fix

**Signup is still broken on production** after Part 5, exactly as it was
before. `0018` no longer makes it worse, and never made it better. Resolving it
means creating `vendors`, or removing the trigger — a decision about foreign
infrastructure that belongs to its owner.

**Gate 1 cannot be called production-ready while no user can register.**
Recorded as a new blocker: **C9 — production signup is broken by a foreign
trigger.**
