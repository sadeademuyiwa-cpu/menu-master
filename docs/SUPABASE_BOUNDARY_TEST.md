# Supabase Production-Boundary Test — Setup Instructions

**Status: PREPARED, NOT RUN.** Nothing here has been executed. No Supabase
project has been contacted.

## What this closes

`docs/GATE1_REPORT.md` §7 records the one residual Gate 1 could not close
locally:

> `authenticator` is granted `service_role`, so a raw SQL channel would allow
> `SET ROLE service_role`. … What I cannot verify locally is Supabase's
> production `authenticator` configuration and its default privilege grants.
> **Marked UNVERIFIED.**

Test 003 proves the defence works against a local `authenticator` role that
*we* created. It cannot prove anything about the one Supabase actually ships.
**Until this test passes on a real project, Gate 1 is not production-ready.**

## What you must create

A **brand-new, disposable Supabase project**. Not staging. Not production.

1. **New project** — free tier, any region. Suggested name
   `menu-master-gate1-boundary-test`.
2. **No real data.** Never restore a backup into it and never point it at
   production storage.
3. **Three throwaway users** — Authentication → Users → Add user:
   - `ownera@boundary.test`
   - `ownerb@boundary.test`
   - `cashierb@boundary.test`

   Any password. Record each user's UUID.
4. **Leave auth settings at defaults.** The point is to test what a stock
   project does, not a hardened one.

## What you send me

| Item | Where to find it | Sensitivity |
|---|---|---|
| Project URL | Settings → API → Project URL | Low |
| `anon` public key | Settings → API → Project API keys → `anon` | **Publishable — safe to share** |
| The three user UUIDs | Authentication → Users | Low |

**Do not send the `service_role` key.** Step 4 of the procedure needs it, and I
would rather you ran that one step yourself and pasted the output. If you prefer
to share nothing at all, run the whole script yourself — it prints a pass/fail
table and needs no interpretation from me.

**Never send any key from the production project.**

## Procedure

### 1. Apply the chain
Supabase SQL Editor, in order:
```
0001_init.sql
0002_unit_kind_container.sql     <-- run ALONE, confirm success, then continue
0003_seed.sql
0004 … 0016
```
**Do not run `tests/0000_local_supabase_shim.sql`.** Supabase provides `auth`,
`auth.uid()` and the API roles itself; the shim would collide with them. It is
local-only and marked as such in its header.

### 2. Seed fixtures
Run `tests/006_supabase_boundary_fixtures.sql` in the SQL Editor after
substituting the three user UUIDs at the top. It creates two accounts, a
cashier in account B, and one priced ingredient plus one conversion in
account A.

### 3. Attack over the real REST API
```bash
export SUPABASE_URL="https://<ref>.supabase.co"
export SUPABASE_ANON_KEY="<anon key>"
export USER_A_EMAIL="ownera@boundary.test"   export USER_A_PASSWORD="..."
export USER_B_EMAIL="ownerb@boundary.test"   export USER_B_PASSWORD="..."
export CASHIER_B_EMAIL="cashierb@boundary.test" export CASHIER_B_PASSWORD="..."
./scripts/supabase_boundary_test.sh
```
The script signs each user in for a genuine JWT and replays the cross-tenant
attacks through PostgREST — **not** the SQL Editor, which runs privileged and
would prove nothing.

### 4. The decisive step (service-role escalation)
Requires the `service_role` key. Run it yourself and paste the output:
```bash
export SUPABASE_SERVICE_KEY="<service_role key>"
./scripts/supabase_boundary_test.sh --service-context-check
```
It asserts:
- a genuine `service_role` key (no `sub` claim) → `fn_is_service_context()` = **true**
- an end-user JWT → **false**
- an end-user JWT that has somehow reached `service_role` → still **false**

The third is the one that matters.

### 5. Report
Compare against the local result (54/54 blocked). Any test that is ALLOWED
remotely but BLOCKED locally is a production-only hole and a Gate 1 blocker.

## Teardown

Delete the project. It has no purpose after the test and no data worth keeping.
