# PLAN — after launch readiness: admin, staff, tax, monitoring, UI

**10 September 2026. Plan only. Nothing here is built, and nothing starts
without the owner's go on each part.** Each part is sized in focused
engineering days and lists the decision it needs first. The governing rule
applies throughout: nothing is generated from an assumption about a business;
tax is the one deliberate exception, and it is generated from a *statutory*
fact the owner records, never from a business's own guess.

---

## Part A — Admin panel with monitoring inside it

**Why one thing, not two.** Monitoring that lives in a dashboard nobody opens is
a log file. The people who need to see a failed webhook are the same people
who need to see how many founder slots are left; give them one door.

### A1. Who is an admin

There is no platform-level role today — every role is *within* an account.
Add `platform_admins (user_id primary key, granted_by, granted_at, reason)`,
written only in the service context (a migration, or a definer function the
owner runs). Nobody self-grants. **The database stays the boundary:** every
admin read is a `SECURITY DEFINER` function that first checks
`auth.uid() in platform_admins` and raises otherwise; the `/admin` routes then
merely *offer* what those functions already refuse to anyone else — the same
pattern as the Sales gate.

### A2. What it shows (all read-only, all from views that exist or are cheap)

| Panel | Source | Why it matters at launch |
|---|---|---|
| Billing health | `billing_events` by status · `v_billing_reconciliation` · `v_billing_anomalies` | the only way today to know a webhook failed is to query these by hand |
| Subscriptions | `subscriptions` × `plans` · founder slots claimed / reserved / free | "how many of the hundred are left" |
| Signups | `auth.users` count by day · accounts with no business · trials ending this week | the funnel, and who is about to be locked out |
| Edge functions | last 24 h of `function_edge_logs` via a scheduled pull, or a link to the Supabase log explorer until then | webhook 401s and 500s |
| Advisors | the security/performance advisor output, cached daily | the 23-function `search_path` class of finding, caught before a customer does |

### A3. Alerts

A `platform_alerts` table written by the same job that fills the panels, and
one channel to start: **email to the owner** for `failed_permanent` billing
events, a founder-slot count crossing 90 / 100, and any edge-function 5xx
rate above a threshold. Slack later; the table is the contract, the channel is
plumbing.

**Needs first:** who the first admin is (one email). **Size:** 3–4 days
(migration + functions 1, panels 2, alert job 1).

---

## Part B — Staff management

**What exists:** `memberships (account_id, business_id, user_id, role)` with
roles `owner`, `manager`, `sales`, and every write policy already enforces
them (0015). What is missing is only the *way in*: nobody can be added except
by a migration.

### B1. Invitations, not user creation

Owners invite by email. An `invitations (account_id, email, role, token, invited_by, expires_at, accepted_at)`
row is created by a definer function that checks the caller is the account's
owner; the invitee signs up (or signs in) normally, and on first sign-in a
function matches their email to open invitations and creates the membership.
No password is ever set by the owner, and no `auth.users` row is written by us —
Supabase Auth keeps that job.

### B2. Screens

`/settings/people`: the list (name, email, role, last seen), invite form,
change-role and remove actions, pending invitations with resend/revoke. Rules
the UI shows and the database enforces: an account always keeps at least one
owner; a `sales` member sees no costs (0004/0012 `fn_can_see_costs` already);
removing someone never deletes what they entered.

### B3. Invitation email

The first transactional email the product sends. Keep it to one template,
plain text, from a domain you control; Supabase Auth's SMTP settings can carry
it, or Resend/Postmark when volume warrants.

**Needs first:** approval that owners may hold multiple accounts (today the
checkout refuses an ambiguous account — that rule stays, but the *people* page
must show which account you are managing). **Size:** 3 days.

---

## Part C — Tax, generated rather than entered

**The ruling that already exists.** `PRICING_ECONOMICS_DESIGN.md` §2 (D5,
approved): `tax_mode ∈ {none, inclusive, exclusive}` on `business_settings`,
net is what revenue and margin are computed on, tax collected is never
revenue. The columns `tax_mode` and `tax_rate` exist since 0001 and **nothing
reads them**. The owner's addition today: **the rate is not typed by the
business.**

### C1. What "generated" means here

A business states two facts about itself, both true-or-false and both
verifiable: *"we are VAT-registered"* and *"our prices are quoted
VAT-inclusive"*. Everything numeric is then **derived from a statutory table
the platform maintains**, never from a field the business fills:

```
tax_rules
  jurisdiction      text        -- 'NG'
  kind              text        -- 'VAT'
  rate              numeric     -- e.g. 0.075
  effective_from    date
  effective_to      date
  source            text        -- the Act / Finance Act / FIRS notice it comes from
  recorded_by, recorded_at, reason
```

Append-only, effective-dated, service-context writes only — the same discipline
as `billing_config`. A rate change is a new row citing its source; history
stays. **The rate in force on a sale's date is looked up, not stored on the
business.** `business_settings.tax_rate` becomes unused and is dropped in the
same migration, so there is no second place a rate could live.

### C2. Exempt items

Nigerian VAT exempts basic food items, and a food business sells both exempt
and standard-rated things. This is the part that cannot be generated from a
rate alone: it needs a **per-product classification**, and the honest default
under the governing rule is *"not classified"*, which produces no tax figure
and marks the product incomplete — exactly how a missing price behaves today.
The platform ships the statutory exemption categories as reference data; the
business picks one per product from that list. It never types a rate and
never types a percentage.

### C3. Where the number appears

- At **confirmation** of a sale, tax is computed per line from (rate in force,
  product classification, business mode) and **frozen** on the line beside
  COGS — 0045's freeze already established that economics are fixed at
  confirmation, not at typing time. A rate change tomorrow does not restate
  yesterday's sale.
- `v_price_check` shows net, tax, gross for every priced product, and the
  margin on **net**, so the R1 ruling ("₦3,500 means the customer pays ₦3,500")
  holds on the customer's own menu too.
- A monthly **VAT collected** figure per business — the record R1 says must be
  retained — as a view first, an export second.

### C4. Migrations and tests

0053: `tax_rules` + `product_tax_classes` reference data + business flags;
drop `tax_rate`. 0054: frozen tax on `order_lines`, view changes, the
`v_tax_collected` view. Each with the usual PRE/POST, atomicity and rollback,
and an acceptance suite that asserts: a rate change never restates a confirmed
sale; an unclassified product yields **no** tax figure, not zero; a
non-registered business yields no tax figure anywhere.

**Needs first, from the owner, with sources:** the current statutory VAT rate
and its effective date; the exemption categories to ship; the threshold rule
(registration is a fact the business states, the platform does not decide
it). **I will not put a rate into the table from memory.** **Size:** 4–5 days
after the facts are supplied.

---

## Part D — UI remake: keep the course, make it feel alive

**What stays.** The information architecture, the five-destination
navigation, the copy, the honesty of the empty and blocked states, the
touch-target and overflow rules the audit harness enforces, and the principle
that a hidden button protects nothing. **What changes** is that the product
currently gives no feedback: a tap does nothing until the server answers, a
save succeeds silently, a page swap is a hard cut.

### D1. Feedback for every action (the biggest single gain)

- Every submit button gets a **pressed state**, a **busy state with spinner**
  and a **disabled state while in flight** — one `Button` component, used
  everywhere, so it cannot be forgotten. (`Submit` in `ui.tsx` is the seed.)
- **Toasts** for the result of every save: "Price saved", "Sale confirmed —
  ₦15,000", and the database's own refusal in plain words when it refuses.
  One `Toaster` at the layout root; server actions return a result the page
  turns into a toast.
- **Optimistic updates** where the result is certain (renaming, toggling),
  never where the database decides (confirming a sale, saving a price on an
  incomplete recipe).

### D2. Loading, so nothing looks frozen

- A `loading.tsx` per route group with **skeletons shaped like the page**
  (cards, table rows), not a spinner in the middle of nothing.
- A thin **top progress bar** on navigation.
- `Suspense` boundaries around the slow reads (dashboard, reports) so the
  header and navigation paint first.

### D3. Motion, restrained

- Page transitions with the **View Transitions API** (no library, ~0 KB),
  falling back to none.
- Cards and rows **fade-and-rise** on mount; lists animate insertions; the
  bottom navigation's active pill **slides**.
- `prefers-reduced-motion` respected everywhere, tested by the audit harness.
- No framer-motion unless D3 proves CSS insufficient; the app is 103 KB of JS
  and should stay near it.

### D4. Design tokens

- One type scale, one spacing scale, one radius, one shadow, one motion
  duration/easing pair — as CSS variables in `globals.css` beside the existing
  `--mm-*` colours, so the whole app changes together.
- A **primary/secondary/quiet** button hierarchy so the one action that
  matters on a page is the one that looks like it.
- Inputs get a visible focus ring and a clear error state tied to the
  database's message.

### D5. Gates, so it stays good

- The existing `audit.mjs` (touch targets, text size, overflow, controls
  behind fixed furniture) runs in CI on the mock, at four widths.
- Add: Lighthouse performance and accessibility ≥ 90 on the five primary
  pages; total JS budget 130 KB; every interactive element reachable by
  keyboard.
- The mock fixtures are refreshed first (they have rotted against the recipe
  page) and extended to sales / purchases / dashboard / subscribe.

**Order:** D1 → D2 → D4 → D3, because feedback and loading are what users
feel as "slow" or "broken"; motion is polish on top. **Needs first:** nothing
— but a half-day design review of the button hierarchy with the owner before
D4. **Size:** 6–8 days for D1–D4 across all 28 routes, plus 1 for D5.

---

## Sequence I would recommend

1. Launch prerequisites (separate list, already given): smoke test, 0052, test-footprint repair, live cutover, backups.
2. **D1 + D2** — the product stops feeling static within the first week after launch, and every later screen inherits it.
3. **A** — the owner can see billing and slots without SQL.
4. **B** — staff can be invited.
5. **C** — once the statutory facts are supplied with sources.
6. **D3 + D4 + D5**.
