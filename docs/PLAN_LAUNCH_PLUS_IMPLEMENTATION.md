# PLAN_LAUNCH_PLUS — implementation analysis

**10 September 2026. This turns `PLAN_LAUNCH_PLUS.md` into an ordered build
list: which migration, which function, which route, which test, and what gate
each step passes before the next starts. Nothing here is built. Every item
keeps the two rules that hold across the codebase: the database is the
authority and the screen only offers; and nothing numeric is invented on a
business's behalf.**

**Status (10 September, evening):** §0 done (local stack, journey 87/87).
D1 + D2 built. A built — `0053`–`0055` in `migrations/proposed/`, suites
039–041, `/admin/*`, `platform-alert-mailer`; awaiting the production gate,
the first admin grant, `pg_cron` and a Resend key. B built — `0056`, suite
042, `/settings/people`; awaiting its gate. C waits for the statutory facts
with sources. D3–D5 not started.

Numbering continues from the last proposed migration (`0052`). Each migration
gets the standard kit — transaction guard, preflight, self-check, rollback,
PRE/POST gate files, an acceptance suite, atomicity and fingerprint rehearsal
— produced with the harness that now exists (`setup_db`, `run_suites`,
`regression_check`, `atomicity_check`).

---

## 0. Foundation: local development, before any of the below

Everything after this section is developed and tested **locally**, never on
production. Two environments:

| | Now (B) | Permanent (A) |
|---|---|---|
| Database | PostgreSQL 17 built by `setup_db.ps1` | `supabase start` (Docker) |
| API | real PostgREST 12.2.3 | real PostgREST |
| Auth | `web/e2e/supabase-local.mjs` stand-in issuing real HS256 JWTs | real GoTrue + Inbucket (confirmation emails land locally) |
| Edge functions | not runnable | `supabase functions serve` |
| App | `next dev` with `.env.local` → `127.0.0.1:54321` | same |
| Reset | drop/recreate database, ~1 min | `supabase db reset` |

Deliverables for B — **done 10 September**: `scripts/dev_local.ps1` (start
PostgREST + gateway + `next dev` with one command, stop with Ctrl-C; `-Run`
serves a build and runs a script), the gateway made configurable by
environment instead of its hardcoded `mmlaunch` URL, and the README section
"Running the app locally". **Gate passed:** `journey.mjs` 87/87 locally
against `mm` (0001→0051), plus a 16-route walk at phone and desktop widths
with no overflow, leaks or page errors.
Deliverable for A, once Docker is present: `supabase/config.toml`, a
`supabase/seed.sql` that applies the shim-free chain, and the same README
section pointing at it.

---

## Part A — Admin panel with monitoring inside it

### A1. Migration `0053_platform_admins`

```
platform_admins (user_id uuid primary key references auth.users, granted_by uuid,
                 granted_at timestamptz default now(), reason text not null)
```
RLS on, **no policy** — service context only, like `billing_config`. One
helper, `fn_is_platform_admin()` (`SECURITY INVOKER`, reads `auth.uid()`),
plus `fn_require_platform_admin()` that raises `42501`. The first admin row is
inserted by the migration from a value the owner supplies at rehearsal time —
never a hardcoded email.

Acceptance suite `039`: a non-admin calling any admin function gets `42501`;
an admin gets rows; `anon` can execute nothing; the table has no policy and
`authenticated` holds no privilege on it.

### A2. Migration `0054_admin_reads`

Five `SECURITY DEFINER` functions, each opening with
`perform fn_require_platform_admin()`, each returning a table, each `revoke`d
from `public, anon` and granted to `authenticated` (the admin *is*
authenticated; the function refuses everyone else):

| Function | Returns |
|---|---|
| `fn_admin_billing_health(days int)` | `billing_events` counts by status per day; the open rows of `v_billing_reconciliation` and `v_billing_anomalies` |
| `fn_admin_subscriptions()` | one row per subscription with plan, status, period end, price, founder seq; founder slot totals (claimed / reserved / free / forfeited) |
| `fn_admin_signups(days int)` | signups per day; accounts with no business; trials ending within 7 days |
| `fn_admin_advisor_snapshot()` | the latest cached advisor findings (see A4) |
| `fn_admin_alerts(open_only bool)` | rows of `platform_alerts` |

Suite `040` proves every function refuses a non-admin **before** it reads,
and that none exposes a column that a customer could not already see about
their own account (no card data exists to leak; the check is that no
`payload` column from `billing_events` is returned raw — the redacted shape
only).

### A3. Routes

`web/src/app/(admin)/admin/{page,billing,subscriptions,signups,alerts}` with
a layout that calls `fn_is_platform_admin()` and `redirect('/dashboard')`
otherwise — a courtesy, since the functions already refuse. Pure helpers
(`lib/admin/format.ts`) unit-tested; a mock fixture for the render harness.

### A4. Alerts and the daily job — migration `0055_platform_alerts`

```
platform_alerts (id, kind, severity, subject, detail jsonb, first_seen, last_seen, resolved_at)
```
Filled by `fn_admin_scan()` (service context): `failed_permanent` billing
events; founder slots claimed ≥ 90 and = 100; subscriptions `past_due`
beyond grace; a cached advisor snapshot written into `platform_settings`.
Scheduled with `pg_cron` on the Supabase project (extension available on
Free), hourly. **Email** on a new alert: an edge function
`platform-alert-mailer` reading unsent alerts and calling Resend, with the
API key in the edge-function secret store like the Paystack key. Suite `041`
proves scan idempotence (a second run adds nothing) and that resolution is
recorded, not deleted.

**Order:** 0053 → 039 → 0054 → 040 → routes → 0055 → 041 → mailer.
**Owner decisions before start:** the first admin's email; Resend (or other)
as the mail provider. **Estimate:** 3–4 days.

---

## Part B — Staff management

### B1. Migration `0056_invitations`

```
invitations (id, account_id references accounts, email citext, role member_role,
             token text unique default encode(gen_random_bytes(24),'hex'),
             invited_by uuid, expires_at timestamptz default now()+interval '7 days',
             accepted_at timestamptz, revoked_at timestamptz)
```
Policies: an account owner may `select/insert/update` its own invitations
(`fn_has_account_role(account_id, array['owner'])`); nobody else sees them.
Functions: `fn_invite_member(account_id, email, role)` (owner-only, refuses a
second owner role by invitation — owners are made by transfer, not invite);
`fn_accept_invitations()` (`SECURITY DEFINER`, runs for the signed-in user,
matches `auth.email()` to open, unexpired, unrevoked invitations, creates the
membership, stamps `accepted_at`); `fn_remove_member(account_id, user_id)`
refusing to remove the last owner. Suite `042` covers all three plus the
attack cases: accepting someone else's invitation, an expired token, a
`sales` member inviting.

### B2. Routes

`/settings/people`: members list, invite form, change role, remove, pending
invitations with resend/revoke. `fn_accept_invitations()` is called from the
existing `currentContext()` once per session so an invitee lands in the right
account after signup with no extra step.

### B3. Email

One template. Sent by the same mailer edge function as A4 (one secret, one
provider). Until the provider exists, the invite screen shows the link for the
owner to send themselves — honest, and it unblocks testing.

**Owner decisions:** whether a `manager` may invite `sales` members (default:
no). **Estimate:** 3 days.

---

## Part C — Tax, generated

### C1. Migration `0057_tax_rules`

```
tax_rules (id, jurisdiction text, kind text, rate numeric(6,4), effective_from date,
           effective_to date, source text not null, recorded_by text not null,
           recorded_at timestamptz default now(),
           exclude (jurisdiction with =, kind with =, daterange(effective_from, effective_to) with &&))
product_tax_classes (code text primary key, label text, treatment text check (treatment in ('standard','exempt','zero')),
                     source text not null)
business_settings: + vat_registered boolean not null default false
                   + prices_include_tax boolean not null default false
                   - tax_rate (dropped: a rate is never a business's own fact)
recipes / recipe_variants: + tax_class text references product_tax_classes  (nullable = not classified)
```
`fn_tax_rate_on(jurisdiction, kind, day)` returns the row in force or raises
when none is recorded — **it never returns zero for "unknown"**. The table is
seeded **only** with rows the owner supplies with a source; the migration's
self-check asserts every seeded row has a non-empty `source`.

### C2. Migration `0058_frozen_tax`

`order_lines`: `+ tax_rate_applied numeric(6,4), + tax_amount numeric(14,2),
+ tax_treatment text` — written by `fn_confirm_order` at confirmation
(beside the COGS freeze from 0045) from: the business flags, the product's
class, and `fn_tax_rate_on(…, order_date)`. Unclassified product on a
VAT-registered business → the order **cannot be confirmed**, with a message
naming the product, exactly as an unpriced ingredient blocks a cost. Views:
`v_price_check` gains `net`, `tax`, `gross`; margin stays on net (R1);
`v_tax_collected` per business per month; `v_sales_unified.net_revenue` per
the D5 design.

Suite `043`: a rate change never restates a confirmed line; an unclassified
product yields no figure and blocks confirmation; a non-registered business
yields no tax figure anywhere; inclusive and exclusive modes agree on net.

### C3. UI

Settings gains the two flags with plain-language help. Product pages gain a
**class picker from the reference list** (never a rate field). Price check
shows net / tax / gross. A "VAT collected" report.

**Owner facts required before 0057 can be seeded, each with its source:**
the current statutory VAT rate and its effective date; the exemption
categories to ship; confirmation that registration is the business's own
declaration. **Estimate:** 4–5 days after the facts are supplied.

---

## Part D — UI remake

### D1. Feedback — `web/src/components/button.tsx`, `toaster.tsx`, `lib/ui/result.ts`

One `Button` (`primary | secondary | quiet`, `busy`, `disabled`, pressed
state via `:active` and a 120 ms scale); every `<form>` submit and the plan
chooser move to it. Server actions return `{ ok, message }`; a `Toaster` at
the `(app)` layout root renders them, using `describeWriteError` for
refusals so the database's own reason reaches the screen in plain words.
Optimistic updates only for rename/toggle actions.

### D2. Loading — `skeleton.tsx` per route + `components/skeleton.tsx`

A top progress bar (`components/progress.tsx`, ~50 lines, no library) on
every navigation and submit. Skeletons shaped like each page's cards and
rows, **only on read-only pages reached by a link** — dashboard, reports,
pricing, account, subscribe, more, the admin views — each exporting a thin
wrapper that renders its body inside an in-page `<Suspense>` with the
route's `skeleton.tsx` as the fallback.

**Not on pages with actions, and never `loading.tsx`.** The first build used
route-level loading files and the customer journey regressed: a server
action redirecting back to the same route — every Add, Save and Record —
took 7–19 s to show its result instead of ~2 s, because the router aborted
the redirect's payload and stalled the transition (Next 15.5, measured in
the production build against the local stack). In-page boundaries on those
pages stalled intermittently. Removing the boundary from every page with a
same-route action restored HEAD's timing; React keeps the old page on screen
until the new one is ready and the bar shows the wait. The rule is written
into `components/skeleton.tsx`; `journey.mjs` is the proof.

### D3. Motion — `globals.css` + `lib/ui/motion.ts`

View Transitions on navigation with a no-op fallback; mount fade-and-rise
for cards; sliding active pill in the bottom nav; everything behind
`@media (prefers-reduced-motion: no-preference)`.

### D4. Tokens — `globals.css`

`--mm-space-*`, `--mm-text-*`, `--mm-radius`, `--mm-shadow`, `--mm-motion-*`
beside the existing colours; the button hierarchy; visible focus ring and
error state on `mm-input`.

### D5. Gates — CI

`audit.mjs` on the mock at four widths (touch targets, text size, overflow,
controls behind fixed furniture) becomes a CI job; Lighthouse CI on five
pages with performance and accessibility ≥ 90; a JS budget assertion (130 KB
first load). The mock fixtures are refreshed to the current recipe page and
extended to sales, purchases, dashboard and subscribe first — the harness is
only worth gating on once it renders the real pages.

**Order:** D1 → D2 → D4 → D3 → D5. **Owner decision:** a half-day review of
the button hierarchy before D4. **Estimate:** 6–8 days.

---

## Sequence and gates, end to end

| # | Step | Gate to pass before the next |
|---|---|---|
| 0 | Local environment (B now, A when Docker is present) | `journey.mjs` green locally |
| 1 | Launch prerequisites (already listed): smoke on local, 0052, test-footprint repair, live cutover, backups | live payment verified and refunded |
| 2 | D1 + D2 | audit harness green at four widths; no page without a busy state |
| 3 | A (0053–0055, routes, mailer) | suites 039–041; admin sees the two live subscriptions |
| 4 | B (0056, routes) | suite 042; an invited `sales` user can log in and sees no costs |
| 5 | C (0057–0058) — after the facts arrive with sources | suite 043; a confirmed sale carries frozen tax |
| 6 | D3 + D4 + D5 | Lighthouse ≥ 90, JS ≤ 130 KB |

Every migration above goes to production through the same gate as 0049–0052,
and moves from `proposed/` to `migrations/` only when its `POST_VERIFY`
passes there.
