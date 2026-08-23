# Diagnostics

Read-only investigative queries written during the Gate 1 disposable-project
verification. Preserved because several are directly reusable — in particular
for auditing the production project before `0017`/`0018` are proposed there.

**Disposable / non-production projects only unless stated otherwise.** All of
these are `SELECT`-only except `FIX_signin.sql`, which is clearly marked.

| File | Purpose | Writes? |
|---|---|---|
| `DIAGNOSE_grants.sql` | Per-table privileges held by `anon` and `authenticated`, flagging `TRUNCATE`/`TRIGGER`/`REFERENCES` — the ones RLS cannot gate. **This is the production audit query.** | no |
| `GRANT_FINGERPRINT.sql` | Reduces the whole client grant surface to one short hash plus counts. Run before and after a migration to prove it changed nothing. | no |
| `DIAGNOSE_signin.sql` | Why one user can sign in and another cannot: confirmation state, password presence, banned/deleted, provider. Shows no password hashes. | no |
| `DIAGNOSE_authpath.sql` | Replays a user's authenticated call server-side — sets the JWT subject, switches to `authenticated`, walks the authorization chain step by step and reports where it stops. | no |
| `DIAGNOSE_ids.sql` | Whether the ids a harness is using match the real fixtures. Written after a single mistyped UUID cost most of a session. | no |
| `DIAGNOSE_identity.sql` | Whether each user's current auth id still has a membership row. | no |
| `DIAGNOSE_control.sql` | Five-part check of why a costing control test failed: identity, orphaned accounts, settings, price rows, service-context cost. | no |
| `DIAGNOSE_users.sql` | Early user-state comparison. Superseded by `DIAGNOSE_signin.sql`. | no |
| `FIX_signin.sql` | **WRITES.** Resets fixture passwords that do not match, and verifies with `crypt()` without signing in. Disposable projects only — it rewrites `auth.users`. | **yes** |

## Deliberately not preserved

`menu-master-boundary-test.html`, `-v2`, `-v3` and `menu-master-signin-diagnostic.html`.

v4 is committed as `tests/boundary_test.html`; the earlier versions are
strictly worse and one is actively dangerous. **v2 scored any HTTP ≥ 400 as
"blocked"**, so a missing function, a stale schema cache or a bad key counted
as a successful security control — it would have reported eleven green
"blocked" lines on a database with no security at all. Keeping a runnable
harness with that flaw invites someone running it and believing the result.

The flaw and its correction are documented in
`docs/SUPABASE_BOUNDARY_RESULT.md` §5, which is the part worth keeping.
