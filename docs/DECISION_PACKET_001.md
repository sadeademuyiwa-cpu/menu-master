# DECISION PACKET 001 — 25 AUGUST 2026

Seven decisions. All seven block P0 work. Answer with the letter; anything you
skip stays blocked and I will not choose for you.

---

## DECISION 1 — Frontend stack *(blocks all of Track C)*

**Issue.** No frontend exists — no `package.json`, no `src/`. Nothing in the
repository states a stack, so this cannot be derived; it must be chosen.

**Option A — Next.js (App Router) + TypeScript + Tailwind, deployed on Vercel.**
Supabase's first-class path, `@supabase/ssr` handles session cookies, server
components keep the publishable key handling simple, mobile-responsive with
Tailwind out of the box.

**Option B — Vite + React SPA + TypeScript, deployed as static hosting.**
Simpler build, no server runtime to reason about, but session handling and any
future server-side secret work is on us.

**Recommendation: A.** Six days is not enough time to hand-roll auth session
handling, and Gate 3's webhook already puts us in Supabase Edge Functions —
staying on the supported path removes a class of problems we cannot afford to
debug this week.

**Consequence.** A commits us to a Vercel deployment target and a Node build.
B is faster to stand up on day one and slower for everything after.

---

## DECISION 2 — C4 subscription entitlement *(blocks B8, C18)*

**Issue.** `GATE1_VERDICT.md` §4 names entitlement enforcement as a launch
condition: *"Nothing in `0001`–`0018` reads `subscriptions.status`.
`fn_account_is_entitled()` does not exist, so a cancelled account is not
actually denied anything."* It was named but never designed. Today a cancelled
account keeps full access.

**Option A — Hard gate.** `fn_account_is_entitled(account_id)` plus RLS
predicates on write paths: a non-entitled account can read its data and export
it, but cannot create or modify. Paid plans become real.

**Option B — Soft gate.** Entitlement is read and displayed, banners warn, but
nothing is refused before launch; enforcement lands post-launch.

**Recommendation: A**, limited to write paths, with read and export always
open. B means the paid plan is decorative on day one, and a plan nobody is
forced to keep is not a business model.

**Consequence.** A costs ~8h and touches RLS on roughly 20 tables — that is a
security-surface change and needs its own attack test. B costs ~2h and defers
revenue enforcement past a launch that is partly about revenue.

---

## DECISION 3 — Channel commission *(blocks E1, P0)*

**Issue.** Audit item 27: `channels.commission_pct` is stored **and selected in
`v_price_check`**, but enters no calculation. A 20 % delivery-platform
commission currently does not reduce the reported margin at all — the number is
on screen and lying.

**Option A — Commission reduces net revenue.**
`net = selling_price × (1 − commission_pct)`, margin computed off net, and the
recommended price grossed up so the target margin survives the commission.

**Option B — Display only.** Leave it inert, label it clearly as not applied.

**Recommendation: A.** It is 4h, it is already half-built, and a margin figure
that ignores a fifth of the revenue is worse than not showing one.

**Consequence.** A changes reported margins on every channel that has a
non-zero commission — that is intended, but it will look like a regression to
anyone who saw the old number. Needs a before/after list.

---

## DECISION 4 — Costing-method change audit *(E2, P1)*

**Issue.** Audit items 23/24: `costing_method_changes` exists and **is never
written to**. Changing the costing method is a silent `UPDATE`, which violates
approved Decision 2. Snapshots record their own method, so history is safe —
but the change itself is invisible.

**Option A — Wire it up.** A trigger writes a dated row on every method change;
the UI shows the history.

**Option B — Leave it.** Ship with the table empty and the change silent.

**Recommendation: A.** 4h, the table and the approved decision already exist,
and this is the same pattern we just honoured for `serving_format_changes` in
`0021` — leaving one wired and the other not is incoherent.

**Consequence.** Negligible risk; the trigger is append-only and mirrors one
already tested.

---

## DECISION 5 — Tax scope *(E3, contradiction)*

**Issue.** Two approved documents disagree. `docs/MENU_MASTER_NG_AUDIT.md` §3
item 28: *"Tax configuration in MVP scope … `tax_mode` and `tax_rate` exist.
**Nothing anywhere reads them.**"* `GATE1_CLOSURE_REPORT.md` §3 defers tax as
item **P1.5**, *"Outstanding MVP/product item, not a Gate 1 concern"*. One of
the two is wrong and I will not pick.

**Option A — Tax is launch scope.** Implement inclusive/exclusive handling
through costing, pricing and reporting. ~6h plus test matrix.

**Option B — Tax is post-launch.** The columns stay, the UI marks tax as not
yet applied, nothing reads them.

**Recommendation: B for 1 September**, then A immediately after. Tax touches
every price and every report; six days with an unbuilt frontend is the wrong
week to change the meaning of every number. But if you sell to VAT-registered
customers from day one, that answer flips and you should say so.

**Consequence.** B means invoices and reported margins are pre-tax on launch
day and must be labelled as such — that is the honesty cost of deferring.

---

## DECISION 6 — Period close *(E4, P1)*

**Issue.** Audit item 31: `period_closes` exists; **nothing writes to it and
nothing enforces it.** A closed month is not actually closed — historical rows
remain editable within the limits `0014` imposes.

**Option A — Enforce.** Closing a period writes the row and a guard refuses
writes dated inside a closed period.

**Option B — Defer.** Post-launch.

**Recommendation: A** if you intend to report monthly figures to anyone outside
the business; **B** otherwise. 6h. Note that `0014` already makes finalised
revenue immutable, so the exposure is narrower than it sounds — this is about
the whole period, not individual sales.

**Consequence.** A can surprise a user mid-correction; the UI must explain
refusals clearly.

---

## DECISION 7 — Email confirmation on signup *(blocks C5)*

**Issue.** Carried over unresolved from the C10 work: when the disposable test
user was created, no Auto Confirm option was available, and we never settled
whether production requires email confirmation before onboarding.

**Option A — Require confirmation.** Standard, prevents junk accounts, adds a
step and a deliverability dependency before anyone can use the product.

**Option B — No confirmation at launch.** Fastest path to first value; junk
accounts possible.

**Recommendation: A**, because the five existing production users are already
in an unknown state and adding unverifiable accounts on top of that makes the
user table harder to reason about, not easier.

**Consequence.** A requires SMTP configured in Supabase Auth **before** launch —
that is an external dependency, and it belongs on today's list.

---

## EXTERNAL DEPENDENCIES TO OBTAIN TODAY

Only you can get these. Each one gates work that cannot start without it.

| # | Dependency | Gates | Why today |
|---|---|---|---|
| 1 | **Paystack test-mode account + secret key** | B3–B7, the entire billing track | Sandbox evidence is the slowest item on the board and it is not under our control |
| 2 | **Supabase SMTP / email sender** | C5 signup, if DECISION 7 = A | Deliverability problems surface late and take days |
| 3 | **Vercel account**, if DECISION 1 = A | C4 scaffold, D12 deployment | Deployment target must exist before there is anything to deploy |
| 4 | **`0021` production execution** | A4–A10, all of Gate 2 | It is approved and reviewed; nothing in Gate 2 moves until it lands |

The `service_role` key must never be pasted into this chat, committed, or
printed in logs or evidence. Paystack keys are subject to the same rule.
