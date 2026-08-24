# Signup Architecture Reconciliation

**Status:** analysis and proposed remediation only. Nothing has been applied to
production. `handle_new_user` has not been dropped. The revised `0018` has not
been applied. Part 5 has not been run.

**Method:** every claim below is either read from the migration chain in this
repository, read from production by a pure-SELECT script, or reproduced on a
throwaway local replica built from `tests/0000_local_supabase_shim.sql` plus
`deploy/PART_1..PART_5`. Where a claim is inferred rather than observed, it says so.

---

## A. Current signup architecture (production, today)

```
  client
    │  POST /auth/v1/signup
    ▼
  GoTrue ──── INSERT INTO auth.users ─────────────────────┐
                                                          │  same transaction
              AFTER INSERT ... FOR EACH ROW               │
              trigger  on_auth_user_created               │
                  │                                       │
                  ▼                                       │
              public.handle_new_user()   SECURITY DEFINER │
              owner: postgres                             │
                  │                                       │
                  │  insert into vendors (id, contact_name)
                  │  values (new.id, new.raw_user_meta_data->>'name')
                  ▼                                       │
              ERROR 42P01: relation "vendors" does not exist
                  │                                       │
                  └──── exception propagates ─────────────┘
                                  │
                                  ▼
                     the INSERT into auth.users ROLLS BACK
                                  │
                                  ▼
                     GoTrue returns a signup failure
```

**Observed on production** (`C2_HANDLE_NEW_USER.sql`, `C2_FOREIGN_OBJECTS.sql`):

| Fact | Value |
|---|---|
| `public.handle_new_user` | present, SECURITY DEFINER, owner `postgres` |
| Trigger | `auth.users → on_auth_user_created`, AFTER INSERT, FOR EACH ROW |
| Function body | `insert into vendors (id, contact_name) values (new.id, new.ra…` |
| A relation named `vendors` | **exists in no schema** |
| `auth.users` rows | **0** |
| `accounts` / `memberships` / `profiles` rows | 0 / 0 / 0 |

**Reproduced locally, byte for byte:**

```
insert into auth.users (id,email) values ('1111…','a@x.ng');
ERROR:  relation "vendors" does not exist
CONTEXT: PL/pgSQL function handle_new_user() line 3 at SQL statement
```

**Therefore: production signup is not degraded, it is totally broken.** Not one
user can be created. Zero `auth.users` rows is the consequence, not a coincidence.

**This is not a regression from C2.** The hook predates our deployment: it exists
in no file in this repository, and `C1a_AUDIT_catalogue.sql` — run before Part 1 —
already showed the Menu Master chain had never been applied while this function
was present. Parts 1–4 created no trigger on `auth.users` and did not touch it.
Tracked as blocker **C9**.

---

## B. Root cause of the broken signup

**Proximate cause.** An `AFTER INSERT ... FOR EACH ROW` trigger runs inside the
transaction that performed the INSERT. An unhandled exception in the trigger
function aborts that transaction. `handle_new_user()` has no exception handler,
so the missing `vendors` table converts every signup into a rolled-back
transaction. The failure is fail-closed and total, not intermittent.

**Underlying cause.** `handle_new_user()` is a leftover from a different,
unrelated application that used this same Supabase project and owned a `vendors`
table. That application's schema is gone; the hook it installed on `auth.users`
is not, because dropping a schema does not drop a trigger in `auth`. It is
**orphaned foreign infrastructure**, not Menu Master code.

**It is the only foreign object.** The sweep in `C2_FOREIGN_OBJECTS.sql` returned:

| Sweep check | Result |
|---|---|
| Relations in `public` not created by 0001–0018 | none |
| Functions in `public` not `fn_*` and not extension-owned | `handle_new_user` **only** |
| Triggers on `auth.users` | `on_auth_user_created` **only** |
| Triggers on `public` tables not calling `fn_*` | none |
| Policies on `public` tables not named `p_*` | none |
| Non-standard schemas | none beyond Supabase defaults |

So the remediation surface is exactly two objects, and nothing else in the
database came from anywhere but our migrations.

---

## C. Intended Menu Master signup architecture

### The architectural question: what creates the account and business after authentication succeeds?

**The client does, by an explicit authorized RPC call. There is no trigger, and
Menu Master does not need one.** Nothing in migrations 0001–0018 creates a
trigger on `auth.users` — `on_auth_user_created` appears in zero chain files.

```
  1. client → GoTrue signup / login
             → auth.users row created, JWT issued (claim sub = user id)
             → NOTHING ELSE HAPPENS. No account exists yet. This is correct.

  2. client collects the onboarding form:
             account name, business name, business type, currency

  3. client → PostgREST  POST /rpc/fn_create_account_and_business
             role: authenticated, JWT sub = the new user

  4. fn_create_account_and_business()  SECURITY DEFINER, search_path = public
     (migrations/0012_gate1_authorization_hardening.sql:586)

       authorization, before any write:
         · not service context → v_user := auth.uid()
         · p_user_id <> auth.uid()  → 42501 "You may only create an account for yourself"
         · auth.uid() is null       → "A user is required to own the account"
         · no matching auth.users row → "User % does not exist"
         · blank account or business name → refused

       then, in ONE transaction:
         accounts            ← the account
         memberships         ← the caller, role 'owner'   (forced to the caller)
         businesses          ← name + slug + type
         locations           ← 'Main', is_default
         business_settings   ← currency (default NGN)
         channels            ← 'Direct', is_default
         fn_clone_starter_catalog(account, type)
                             ← 180 ingredients: NAMES AND UNITS ONLY
         subscriptions       ← plan 'trial', status 'trialing',
                               trial_ends_at = now() + 14 days

       returns { account_id, business_id, location_id,
                 ingredients_added: 180,
                 next_step: 'enter_your_own_prices' }
```

### Why the RPC is the right shape and a trigger is the wrong one

1. **A trigger cannot know the business.** Account name, business name and
   business type are user input from the onboarding form. A trigger on
   `auth.users` sees only the auth payload. To create a business it would have to
   invent a name and a type — which the source-of-truth rule forbids outright.
2. **A trigger makes onboarding failures look like authentication failures.**
   That is precisely the outage production is in right now. Keeping onboarding
   out of GoTrue's transaction means a rejected business name returns a form
   error, not a broken account.
3. **Onboarding is legitimately retryable.** The RPC can be called again after a
   validation failure. A one-shot trigger cannot.
4. **Authorization is explicit and testable.** The RPC pins the owner membership
   to `auth.uid()`, so it cannot mint ownership for another user. A SECURITY
   DEFINER trigger running as `postgres` has no caller to check.
5. **The completeness gate is preserved.** The starter catalogue clones names and
   base units only. `ingredient_prices` stays empty and `next_step` is
   `enter_your_own_prices`. No price, conversion, yield or labour rate is invented.

### End-to-end verification on the local replica

With the hook removed and nothing else changed:

| Step | Result |
|---|---|
| Insert into `auth.users` (GoTrue equivalent) | `INSERT 0 1` |
| `fn_create_account_and_business` as `authenticated`, JWT sub set | returns account, business, location |
| `ingredients_added` | **180** |
| `ingredient_prices` | **0 rows — nothing invented** |
| accounts / memberships / businesses / subscriptions | 1 / 1 / 1 / 1, subscription `trialing` |

### One genuine gap: `profiles` has no writer

`profiles` is created in `0001_init.sql:34`:

```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text, phone text, created_at timestamptz not null default now());

create policy p_profiles on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());
```

Verified across the whole chain and the built database:

- **Nothing writes it.** No migration, function, or trigger inserts into it.
- **Nothing reads it.** No view and no function references it (checked against
  `pg_rewrite` dependencies and every `pg_get_functiondef` in `public`).
- After a successful signup it holds **0 rows**.
- Grants are already correct: `authenticated` has SELECT/INSERT/UPDATE/DELETE,
  gated by RLS to the caller's own row; **`anon` has none**.

**This is not a break, and I am not proposing a migration for it.** `full_name`
and `phone` are user-entered personal data; the correct writer is the client
upserting the signed-in user's own row, which the existing RLS policy already
permits exactly and only. Flagging it so you can confirm that is intentional
rather than an omission.

**Do not fix it with a trigger that copies `raw_user_meta_data` into `profiles`.**
That would reintroduce the same coupling to GoTrue's transaction that is causing
the current outage, and would populate personal fields from data the user did not
enter into Menu Master.

---

## D. Legacy objects: remain or remove

### Remove — exactly two objects, nothing else

| Object | Why |
|---|---|
| trigger `on_auth_user_created` on `auth.users` | Breaks 100% of signups. Serves no Menu Master purpose. |
| function `public.handle_new_user()` | Its only caller is that trigger. Targets a table that does not exist. |

**Nothing else is removed.** There is no `vendors` table to drop — it does not
exist, which is the entire problem. There is no foreign data anywhere.

### Proof that removal deletes no data

Counts taken immediately before and immediately after applying the removal on a
full replica:

| | `auth.users` | `accounts` | `units` | `catalog_ingredients` |
|---|---|---|---|---|
| before | 0 | 0 | 45 | 180 |
| after | 0 | 0 | 45 | 180 |

Production currently holds 0 `auth.users` rows, so there is not even a user
record that could be affected.

### Remain

Everything else, including `profiles` (client-owned, see C) and all 43 relations
and 40 `fn_*` functions from the chain.

---

## E. Exact proposed migration changes

Three files, none in the deploy chain, none applied.

### `migrations/proposed/0019a_disable_foreign_signup_hook.sql` — reversible, recommended first

Preflight refuses unless: the trigger exists; it is not already disabled; and
`current_user` owns `auth.users`. Logs `pg_get_functiondef(handle_new_user)`
before acting. Then the single operative statement:

```sql
alter table auth.users disable trigger on_auth_user_created;
```

Self-check confirms `tgenabled = 'D'` and prints the exact re-enable statement.
It drops nothing and alters no definition.

### `migrations/proposed/0019b_remove_foreign_signup_hook.sql` — permanent, only after the signup test passes

Preflight refuses unless **all** hold:

- `handle_new_user` exists;
- **no relation named `vendors` exists in any schema** — if one appeared, the
  hook might be functional and must not be touched;
- the body still references `vendors` — it is still the broken one;
- it is not owned by an extension;
- no trigger on any `public` table uses it;
- **`current_user` owns `auth.users`** (required for `DROP TRIGGER`) and owns
  the function (required for `DROP FUNCTION`) — new in this revision.

Logs the full definition, then:

```sql
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
```

Self-check confirms both are gone.

### `deploy/runbook/C2_TRIGGER_AUTHORITY.sql` — pure SELECT, run this first

`DROP TRIGGER` requires ownership of the **table**, not the trigger. On Supabase
`auth.users` belongs to `supabase_auth_admin`, and the SQL Editor's `postgres`
role is **not** a superuser. Whether it can drop this trigger is therefore a real
open question, and this script answers it by asking Postgres directly instead of
attempting anything:

```sql
pg_has_role(current_user, c.relowner, 'USAGE')  -- for auth.users
pg_has_role(current_user, p.proowner, 'USAGE')  -- for handle_new_user
```

Validated on the replica in both directions: it reports `YES` when the role owns
the table and `NO` when a non-superuser role does not.

**If it reports `NO`, do not attempt a workaround.** Stop and report the owner —
the fix then goes through the Supabase dashboard or support, not through a
privilege escalation.

---

## F. Revised scoped `0018`

**`0018` needs no further change on account of this finding, and I am not
proposing one.** The scoping fix already made is sufficient. Specifically:

**The function loop is scoped and will not touch the hook.** It matches
`proname like 'fn\_%'` and skips extension-owned functions, so `handle_new_user`
is never a target. `0018` instead prints it:

```
0018: LEFT UNTOUCHED (not Menu Master functions): handle_new_user
```

That NOTICE is now a deliberate part of the Part 5 evidence (see I).

**The table statements are schema-wide, and that is safe here — verified, not
assumed.** `revoke all on all tables in schema public from anon` and the
`relkind in ('r','p','v','m','f')` loop cover the whole schema rather than an
explicit list. The foreign-object sweep proves `public` contains **only** our 43
relations, so schema-wide is exactly our list today. Recorded so it is a known
property rather than a surprise.

**`service_role` is deliberately untouched throughout.**

**No EXECUTE exposure to revoke.** `handle_new_user()` returns `trigger`.
PostgreSQL refuses to call such a function outside trigger context, and PostgREST
does not expose functions returning `trigger`. So even with default `PUBLIC`
EXECUTE it is not a callable attack surface. Leaving it alone costs nothing.

**PART_5 checksum is unchanged by this analysis:** `48264bb13b4de435` (sha256,
first 16). The reviewed and approved artefact is the one that would be run.

---

## G. Rollback plan

| Step | Rollback | Tested |
|---|---|---|
| `0019a` (disable) | `alter table auth.users enable trigger on_auth_user_created;` | **Yes.** Re-enabled on the replica and the same signup failed again with `relation "vendors" does not exist` — the rollback is real and complete, not nominal. |
| `0019b` (drop) | No in-place undo of a `DROP`. Both `0019a` and `0019b` log the full `pg_get_functiondef` before acting, so the function and trigger can be recreated verbatim from the run log. | Log capture verified. |
| Part 5 / `0018` | Unchanged from the approved runbook. | — |

**Neither `0019a` nor `0019b` touches data, so no data rollback exists or is
needed.** This is why the two-step split matters: `0019a` restores signup with a
one-statement undo, and `0019b` becomes irreversible only after the signup test
in H has actually passed.

---

## H. Signup test plan

The test must exercise the **real GoTrue path**. Inserting into `auth.users` from
the SQL Editor would prove nothing about the endpoint users actually hit.

**Preconditions:** `0019a` applied; `C2_TRIGGER_AUTHORITY.sql` reported ownership `YES`.

| # | Step | Pass criterion |
|---|---|---|
| 1 | Sign up a real test user via the Supabase Auth API / dashboard | HTTP 200, a user id is returned. **Today this fails.** |
| 2 | Confirm the user | Confirmation succeeds |
| 3 | Call `fn_create_account_and_business` as that user (JWT, role `authenticated`) | Returns `account_id`, `business_id`, `location_id`, `ingredients_added: 180`, `next_step: 'enter_your_own_prices'` |
| 4 | Call it again as user A passing user B's id | **Refused**, `42501` "You may only create an account for yourself" |
| 5 | Call it with `anon` (no JWT) | **Refused** — no `auth.uid()` |
| 6 | Run `deploy/runbook/C2_SIGNUP_VERIFY.sql` | All rows match the expected column |
| 7 | Confirm no prices were invented | `ingredient_prices` = **0 rows** |
| 8 | Confirm the trial | `subscriptions.status = 'trialing'`, `trial_ends_at ≈ now + 14 days` |
| 9 | Delete the test user, re-run `C2_FOREIGN_OBJECTS.sql` | Cascade is clean, no foreign object reappears |

`C2_SIGNUP_VERIFY.sql` is written, is a single pure SELECT, and has been run
against the replica — it correctly reported `1` user, `1/1/1` account/business/
location, one owner membership, `trialing=1`, 180 ingredients, `PASS - 0 price
rows, nothing was invented`, and `profiles = 0`.

**Only after steps 1–9 pass should `0019b` be considered.**

---

## I. Revised Part 5 GO / STOP gate

**Part 5 does not depend on the signup fix, and the signup fix does not depend on
Part 5.** `0018` is grant hardening; it neither reads nor writes `auth.users` and
its function loop excludes `handle_new_user` by name pattern. They are
independent, so ordering is a matter of preference, not correctness.

**Recommended order: run Part 5 first, then fix signup.** Part 5 is the reviewed,
checksummed artefact you have already approved in principle, and closing the
grant surface before the first real user exists is strictly better than after.

### Revised GO criteria for Part 5

| # | Criterion | Expected |
|---|---|---|
| 1 | Part 5 runs without error | no `ERROR` |
| 2 | `0018` self-check notice | `0018 self-check passed: anon holds reference-data SELECT only; …` |
| 3 | **`0018` untouched-functions notice** | `LEFT UNTOUCHED (not Menu Master functions): handle_new_user` — and **nothing else in that list** |
| 4 | **`fn_*` functions in `public`** | **40** — replaces the withdrawn raw count of 69 |
| 5 | **Non-`fn_`, non-extension functions in `public`** | exactly **one**: `handle_new_user` |
| 6 | Public relations | **43**, all from the chain |
| 7 | `handle_new_user` definition | **unchanged** by Part 5 |
| 8 | `anon` grants | SELECT on `units`, `catalog_categories`, `catalog_ingredients`, `plans`, `plan_features` only |
| 9 | `authenticated` | no TRUNCATE / TRIGGER / REFERENCES anywhere |
| 10 | `service_role` | unchanged |
| 11 | Data counts | `units` 45, `catalog_ingredients` 180, `plans` 3, `plan_features` 12 — unchanged by Part 5 |

Criteria 3, 4, 5 and 7 are new: they turn the foreign hook from an unexplained
count discrepancy into an explicitly asserted, bounded, untouched object.

### STOP conditions

- Any additional name appears in the untouched-functions notice → an
  unaccounted foreign object exists → stop and re-run the sweep.
- `fn_*` ≠ 40, or relations ≠ 43.
- `handle_new_user` was altered or removed by Part 5 — it must not be.
- Any error, or any self-check failure.

### After Part 5

1. Run `C2_ACCEPTANCE.sql` (the existing gate).
2. Run `C2_TRIGGER_AUTHORITY.sql` — **read-only**, answers the ownership question.
3. Seek approval for `0019a`.
4. Run the H test plan.
5. Only then seek approval for `0019b`.

**Gate 1 remains CONDITIONAL PASS.** Blocker **C9** — signup non-functional in
production — is now identified, root-caused, bounded to two foreign objects, and
has a tested reversible remedy, but it is not closed until the H test plan
passes against production.
