# STATUS — the one document that says what is true right now

**Last verified: 10 September 2026**, by read-only queries against production
plus a full local run of every non-database check. Everything dated earlier in
`docs/` is a historical record of a decision or a sprint, not a description of
the present. When this file and another disagree, this file is wrong only if
its date is older.

---

## Production

| | |
|---|---|
| Supabase project | `mgbrrrjxbufstsjrdoug` (eu-west-2), PostgreSQL 17.6, **Free plan** (no PITR, no scheduled backups) |
| Database migration level | **0051** — `fn_my_has_sales` present, `fn_billing_apply` derives the paid period, 117 RLS policies, 100 founder slots (1 claimed), plan codes mapped |
| Paystack | **TEST mode.** Four test plans mapped to `plans.provider_plan_code`; `trial` unmapped by design |
| Edge functions | `paystack-webhook` v9 ACTIVE (`verify_jwt=false`, HMAC-authenticated); `paystack-checkout` v5 ACTIVE (`verify_jwt=true`) |
| Live data | 10 auth users · 4 subscriptions · 1 paid subscription (`founding_costing`, active, renews 2026-10-08) |
| Frontend | `menumasterng.com` on Vercel, built from the branch below |
| Paid access | one real TEST-card payment has completed end to end: charge → webhook → subscription active → founder slot confirmed |

## Branches — read this before deploying anything

| Branch | Role | Head (10 Sep) |
|---|---|---|
| `claude/menu-master-ng-migrations-3faerm` | **Production-tracked. Vercel builds this.** | `28caa22` until fast-forwarded — see below |
| `claude/0049-artifacts` | Working branch. All billing work (0049–0051, checkout, ops scripts) lives here | `f295569`+ |
| `main` | **Stale.** 3 commits behind the production-tracked branch. Not production | `f32920b` |
| `claude/gate1-closure` | Historical | — |

**Current mismatch:** the production *database* is at 0051, but the
production-tracked *branch* is at `28caa22`, which predates all billing code.
The fix is a fast-forward (no merge is needed — `28caa22` is an ancestor):

```
git checkout claude/menu-master-ng-migrations-3faerm
git merge --ff-only claude/0049-artifacts
git push origin claude/menu-master-ng-migrations-3faerm      # this is a production deploy
```

## Migrations

`migrations/` holds every migration **applied to production**, in order.
`migrations/proposed/` holds only what is **authored and not yet applied**.
A migration moves from `proposed/` to `migrations/` when its `POST_VERIFY`
passes on production, and not before. Rollbacks live in `migrations/rollbacks/`.

Migrations `0019c`–`0030` carry production-specific preflights (exact md5 of a
function body, exact object counts). They apply to a **fresh** database only
with `mm.fresh_install = on` — see `scripts/setup_db.ps1` / `scripts/setup_db.sh`.

Verified against production on 10 Sep: a distinctive object from every
migration `0019c`, `0020`, `0021`, `0024`, `0027`, `0030`–`0051` is present and
the `fn_*` count is exactly the 77 expected at 0051. `0022` (backfill of default
variants) leaves no object of its own; it ran in the rehearsed bundle and with
zero recipes at the time was a no-op either way. `0019a` and `0019b` were
alternatives to `0019c` and were never applied.

## Verification state

| Check | Result (10 Sep) | How to run |
|---|---|---|
| Web typecheck | clean | `cd web && npm run typecheck` |
| Web unit tests | 63 / 63 | `cd web && npm test` |
| Web build | 34 routes, exit 0 | `cd web && npm run build` |
| Edge function unit tests | 35 / 35 (webhook 15, checkout 14, alert mailer 6) | `deno test supabase/functions/*/lib_test.ts` |
| Ops script tests | 70 / 70 | `pwsh -File scripts/ops/PaystackOps.Tests.ps1` |
| SQL suites (42) | run as `tests/MANIFEST` directs: each at head on a virgin copy unless pinned to the migration it was written for (`era=`, built through `proposed/` when the era is not yet shipped), gated on one still proposed (`requires=`), or sharing a copy in sequence (`seq=`). The three boundary users the 006→007→009 chain needs come from `tests/fixtures/` (local shim only). **Head + proposed (0001→0056): 40 suites, 874 pass, 0 fail.** Head only (0051) still reports the two `billing_config` rows that 0052 closes | `scripts/setup_db.ps1 -Database mmp -WithProposed` then `scripts/run_suites.ps1 -Template mmp` |
| Render evidence | 142 screenshots in `web/e2e/shots/` (three generations) | `cd web && npm run e2e` |
| Customer journey, real browser, local stack | **87 / 87** on 10 Sep against `mm` (0001→0051) through real PostgREST 12.2.3: signup → onboarding → first cost → margin → purchases → formats → overhead → isolation between accounts → phone widths | `pwsh -File scripts/dev_local.ps1 -Build -Run web/e2e/journey.mjs` |
| Route walk, real browser, local stack | 16 routes × 2 widths, all 200, no overflow, no `NaN`/`undefined`, no page errors | same stack; see README "Running the app locally" |
| Staff invitations, real browser, local stack | **14 / 14** on a 0001→0056 database: owner invites → invitee signs up and lands in the business → sees no costs → role changed → removed → back to onboarding | `pwsh -File scripts/dev_local.ps1 -Database <db-with-0056> -Run web/e2e/people.mjs` |
| Feedback (D1) and loading (D2) | busy state on every submit, toast on every outcome (info / refusal), progress bar on link and submit, skeletons on read-only pages — probed in the production build; journey unchanged at 87 / 87 | `docs/PLAN_LAUNCH_PLUS_IMPLEMENTATION.md` §D1–D2 |

## Supabase advisors (10 Sep, read-only)

**Security** — 23 functions with a mutable `search_path` (WARN, cheap fix);
38 `SECURITY DEFINER` functions callable by `authenticated` (WARN — this is the
deliberate RPC surface, asserted by `tests/034`; review, do not blanket-revoke);
`billing_events` and `founding_price_policy` have RLS with no policy (INFO —
intentional, service-context only); leaked-password protection is off (WARN).

**Performance** — 138 unindexed foreign keys (`sales_entries` 13, `orders` 11,
`purchases` 11, `order_lines` 9 …); 3 policies re-evaluate `auth.uid()` per row
(`profiles`, `onboarding_requests`, `founder_slots`); `units` has overlapping
permissive SELECT policies; 7 unused indexes.

## Proposed, not yet applied

*(Section updated 18 October 2026. Production is at **0066**: 0052–0059 were
applied on 2–3 October, 0060–0062 on 12 October, 0063–0064 on 17 October,
and 0065–0066 on 18 October, all over the session pooler with
`psql --single-transaction`. The rest of this file still describes
10 September and is older than those facts.)*

**Applied 18 October 2026:**

| Migration | Production result |
|---|---|
| `0065_help_videos.sql` | PRE 5/5, `0065 OK`, POST 5/5. site_settings has its sixth row, `help` (empty until the admin sets links). 118 policies, 99 `fn_*` |
| `0066_trial_gate.sql` | PRE 35/35, `0066 OK` (1 live trial moved later to 23:59:59 Lagos, logged), POST 17/17. 118 policies, 102 `fn_*`. The app that uses it (`5535561`) was deployed the same day with `BILLING_SELF_SERVE` unset, so paying owners are told to message us to change or cancel |

Thirteen production function bodies (and three billing bodies) were stored
with CRLF line ends; the preflights now compare their md5 with carriage
returns removed (the text is otherwise identical to a repository build).

**Still proposed:**

| Migration | What | Gate |
|---|---|---|
| `0067_billing_self_serve.sql` | Paystack notices are matched to the account by subscription code or customer code; a replaced subscription is switched off and its later notices change nothing; a cancel or failed payment for a code we do not hold is held for review. Supports Cancel plan, Update your card, Pay now and self-serve plan change (`paystack-manage`, new). 118 policies; `fn_*` 102 → 107 | `deploy/runbook/DEPLOY_0067.md`, then steps 5-11 of `DEPLOY_TRIAL_PHASE1.md` (edge functions, Paystack test-mode checks T1-T13, the two switches) |

Before that, the last two shipped with the food-app redesign
(`branding/09-uiux/04-simplify-plan.md`), and the app that needs them is live
(`6e64741`):

| Migration | What | Production result, 17 Oct |
|---|---|---|
| `0063_dish_photos.sql` | `recipes.photo_path` (nullable; must sit in the dish's own business folder), public storage bucket `dish` (JPEG/WebP, 512 KB), four `mm_dish_*` storage policies: owner, manager and kitchen of an entitled account may add or change a dish's photo, members may list | PRE 9/9, `0063 OK`. Its POST re-run after 0064 passes 6/7: row 6 expects 98 `fn_*` and reads 99, which 0064 adds by design |
| `0064_sales_reads_prices.sql` | `fn_menu_prices()`: current selling prices for owner, manager, sales and accountant, never kitchen, never anything cost-like; `recipe_prices` stays cost-gated | POST 7/7. The API answers a logged-out call with 42501 (permission denied), so the function is exposed and gated |

After both: 118 policies in `public`, 99 `fn_*`, both paying subscriptions
untouched. Runbooks: `deploy/runbook/DEPLOY_0063.md`, `DEPLOY_0064.md`.
Rollbacks: `migrations/rollbacks/0064_rollback.sql`, then `0063_rollback.sql`,
after redeploying the previous app.

## What is not done

- **Live Paystack cutover** — `deploy/runbook/LIVE_CUTOVER.md`. Nothing accepts real money.
- **Tax** (E3), **closed-period immutability** (E4 — `period_closes` exists, nothing enforces it), **commission economics** (E1) — designed, not built.
- **Business / location management screens** (C7). Member management is built (0056 + `/settings/people`), awaiting its production gate.
- **Production monitoring** (D8) is built as the admin panel (0053–0055 + `/admin/*` + the mailer), awaiting its production gate, the first admin grant, `pg_cron`, and a Resend key. A **launch acceptance suite** (D11) is not.
- Advisor items above.
