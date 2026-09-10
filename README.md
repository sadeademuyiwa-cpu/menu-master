# Menu Master NG

Financial operating system for African food businesses.

**Know your cost. Know your price. Know your profit.**

---

## Governing rule

**PERSONAL DATA IS THE SOURCE OF TRUTH.**

Each business's costs are calculated exclusively from that business's own
entered data. A missing price, conversion, yield or labour rate stays NULL and
the record is marked incomplete. Never substitute zero, an industry average, a
benchmark, or an assumed Nigerian market value.

If you are an AI agent working in this repo: read **`STATUS.md`** first — it is
the only document that describes the present. Read `docs/GATE2_FINAL_DESIGN.md`
before proposing any schema change.

---

## Repository layout

```
STATUS.md              what is true right now: production level, branches, tests
migrations/            every migration APPLIED to production, in order (0001 → head)
  rollbacks/           the tested rollback for each migration that has one
  proposed/            authored, rehearsed, NOT yet applied to production
tests/                 SQL acceptance suites, one per migration family (37)
  0000_local_supabase_shim.sql   LOCAL ONLY -- emulates auth.users / auth.uid()
web/                   Next.js 15 app (App Router), Vercel-deployed
  src/app/             routes           src/lib/   data + pure logic
  tests/               unit tests       e2e/       browser harnesses + render evidence
supabase/functions/    paystack-webhook (HMAC-authenticated), paystack-checkout (JWT)
scripts/               setup_db, run_suites, regression/atomicity gates, ops/ (PowerShell)
deploy/runbook/        the gate for every production change: PRE_DEPLOY → migrate → POST_VERIFY
docs/                  design rulings and dated sprint records -- history, not status
```

## Running locally

Requires PostgreSQL 17 (server, not only the client tools), Node 22+, Deno 2,
PowerShell 7.

```powershell
# database: builds 0001 → head from the repository alone, then runs every suite
pwsh -File scripts/setup_db.ps1 -Database mm
pwsh -File scripts/run_suites.ps1 -Template mm

# web
cd web && npm ci && npm run typecheck && npm test && npm run build

# edge functions and ops scripts
deno test supabase/functions/paystack-webhook/lib_test.ts supabase/functions/paystack-checkout/lib_test.ts
pwsh -File scripts/ops/PaystackOps.Tests.ps1
```

On Linux/CI the same two database steps are `scripts/setup_db.sh` and
`scripts/run_suites.sh`; `.github/workflows/ci.yml` runs all of the above on
every push, with no secrets.

`tests/0000_local_supabase_shim.sql` is **local only**. Never run it against
Supabase, which provides `auth.users` and `auth.uid()` itself.

## Changing production

Never through the Supabase SQL Editor for a migration: it commits every
statement individually, which is how production was once left half-migrated.
Every migration from 0049 onward refuses that executor. The procedure is always
the same three files in `deploy/runbook/`:

1. `PRE_DEPLOY_NNNN.sql` — read-only, must pass completely
2. the migration, via `psql --single-transaction -v ON_ERROR_STOP=1`
3. `POST_VERIFY_NNNN.sql` — read-only, must pass completely

Only then does the file move from `migrations/proposed/` to `migrations/`.

## Security boundary

The database is the authority. Row-level security and `SECURITY DEFINER`
functions decide every read and write; the frontend only decides what to
*offer*. A screen that hides a button protects nothing, and is not asked to.
Secrets live in the Supabase Edge Function secret store and nowhere else —
never in Vercel, never in this repository, never on a command line.
