# DEPLOYMENT RUNBOOK — 0066 (the trial gate: after a trial, nothing new is saved except money received)

> ## ⛔ NOT AUTHORISED UNTIL YOU RUN IT. Nothing here has touched production.

Expected starting state: **0064 applied**, 118 policies in `public`, 99 `fn_*`
functions. **0065 (help videos), if it ships at all, goes in before 0066.**
0066 does not need it, but 0065's preflight, its self-check and its suite
(`tests/051` check 12) expect exactly 99 `fn_*`, and 0066 makes it 102: applied
after 0066, 0065 stops with "0065 preflight FAILED: fn_* count is 102,
expected 99." If 0066 is already in, change 0065's two counts and 051 check 12
from 99 to 102 first. PRE row 4 says which case you are in.

Phase 1, Drop B of the trial plan (18 Oct 2026). The owner's decisions:

| | |
|---|---|
| **D1** | A trial ends at **23:59:59 Lagos time on the 14th day** after setup. Trials live when 0066 ships move **later** to the end of their Lagos day, each with one `subscription_changes` row. Ended trials are left alone. |
| **D2** | After a trial, or on Costing, owner, manager and sales can still **record money received** on a sale that was confirmed and not cancelled. Only `amount_paid` and `payment_status` change. Drafts stay locked. |
| **D3** | After a trial (or without Sales) a sale cannot be cancelled or reissued, and a recorded purchase cannot be cancelled or corrected, until a plan is chosen. |
| **D4** | A login that already belongs to an account cannot start a new one through onboarding; it is told to use a different email. |
| **D7** | Custom units: only the roles that edit ingredients (owner, manager, kitchen), only while the account has access. |

## What changes

| | |
|---|---|
| `fn_trial_end(timestamptz)` | **new.** 23:59:59 `Africa/Lagos` on the 14th Lagos day after the start (Lagos keeps one offset all year: 22:59:59 UTC). `STABLE`, runs as the caller; granted to `authenticated` and `service_role`. |
| `fn_require_entitled(uuid, boolean default false)` | **new.** The gate. Returns at once in service context (the operator, the Paystack webhook). Otherwise: not a member → `42501`; account without access → **`MMENT`**; Sales needed and the plan lacks it → **`MMSAL`**. The message is plain English and is shown as it is; `HINT` carries the reason. Runs as the caller, **granted to nobody**: only the definer functions below call it. |
| 13 elevated write functions | **replaced**, each copied word for word from its 0064 definition with **one line** added straight after its role check. Entitlement: `fn_post_purchase`, `fn_correct_purchase`, `fn_reverse_purchase`, `fn_recompute_business_recipes`, `fn_recompute_recipes_for_ingredient`, `fn_compute_recipe_cost_snapshot`, `fn_compute_variant_cost_snapshot`, `fn_clone_starter_catalog`. Entitlement and Sales: `fn_confirm_order`, `fn_finalise_order`, `fn_reissue_order`, `fn_void_order`, `fn_void_sales_entry`. The migration's self-check removes the added line and compares the md5 with 0064's. |
| `fn_record_order_payment(uuid, numeric, payment_status)` | **new.** Owner, manager or sales; confirmed, not cancelled sales only; amount ≥ 0; changes `amount_paid` and `payment_status` and nothing else. No trial or plan check (D2). Its own refusals are SQLSTATE **`MMPAY`** with a plain sentence (below); a role refusal stays `42501` from `fn_require_account_role`. |
| `fn_create_account_and_business` | **replaced**, same signature and grants. For anyone but the operator: `p_trial_days` other than 14 (NULL included) → `22023`; a login that is already staff somewhere → **`MMLGN`**; adding a business to an account without access → `MMENT`. The trial row now goes in **before** the starter catalogue (which is now gated) and ends at `fn_trial_end(now())`. A retried onboarding still replays first. The operator keeps `p_trial_days` and multi-account creation. |
| `fn_guard_subscription_writes` | **replaced.** A trial made outside service context must end at `fn_trial_end(now())`, with `trial_ends_at = current_period_end`. |
| `fn_my_entitlement_status` | **replaced**, same columns: it now names the caller's **oldest** membership, as `fn_my_has_sales` and the app already do. |
| `p_units_write` on `units` | **replaced under the same name** (`for all to authenticated`): adds owner/manager/kitchen and `fn_account_is_entitled`. Reads are unchanged (`p_units_read_own`). |
| live trials | moved to 23:59:59 Lagos on their last day, only ever later; one `subscription_changes` row each: `change_kind` `trial_extended`, `change_source` `owner`, `authorised_by` "Owner decision D1, trial plan of 18 Oct 2026", reason starting "0066:". |
| Policies in `public` | 118 → **118** |
| `fn_*` | 99 → **102** |
| Left open on purpose | member management (`fn_invite_member`, `fn_accept_invitations`, `fn_set_member_role`, `fn_remove_member`, `fn_revoke_invitation`), `fn_record_order_payment`, platform admin, reads. |
| Known exceptions (unchanged by 0066) | two history tables still take a row from a signed-in member after a trial, through row policies that never asked about access: `p_sfc_insert` on `serving_format_changes` (any member) and `p_costing_method_changes_insert` on `costing_method_changes` (the owner). Such a row only describes a change; the change itself is still refused, because the write policies on `serving_formats` and `business_settings` ask for access. The self-check's catalogue rule covers functions only, so it does not report them. Gating them is a later migration, which must also move `tests/018` check 13 and `tests/022` check 24 off 70. |

### Why `p_trial_days` is refused, not ignored

A client that asks for any length but 14 is broken or probing. Silently giving
it 14 days would hide that; a refusal shows up in the logs. The web app never
passes the parameter (its default is 14), so nothing in the app changes.

### Codes the app sees

| SQLSTATE | HINT | When | Message starts |
|---|---|---|---|
| `MMENT` | `trial_ended` | trial over | owner: "Your free trial has ended, so nothing new can be saved. Choose a plan on Plans & billing to carry on." staff: "… Ask the owner to choose a plan." |
| `MMENT` | `payment_failed` | past due beyond the 7-day grace | owner: "Your last payment did not go through … Update your card or choose a plan on Plans & billing …" |
| `MMENT` | `subscription_ended` | cancelled and past the paid period | owner: "Your plan has ended …" |
| `MMENT` | `no_plan` | no subscription row | "This business has no plan yet …" |
| `MMSAL` | `no_sales` | Costing plan, a sales action | owner: "Your plan covers costing only … Choose Costing + Sales on Plans & billing …" |
| `MMLGN` | — | onboarding by a login that is already staff | "This login already belongs to a business on Menu Master. To run a business of your own, sign up with a different email address." |
| `22023` | — | onboarding with `p_trial_days` ≠ 14 | "A free trial is 14 days. It cannot be changed when signing up." |
| `MMPAY` | — | `fn_record_order_payment`: the sale does not exist | "This sale could not be found. It may have been removed." |
| `MMPAY` | — | the sale was cancelled | "This sale was cancelled, so no payment can be recorded on it." |
| `MMPAY` | — | the sale is still a draft | "This sale is still a draft. A payment can be recorded once it is confirmed." |
| `MMPAY` | — | amount below zero or missing | "The amount paid must be zero or more." |
| `MMPAY` | — | amount too large for the column (`numeric(14,2)`) | "That amount is too large to record. Check the figure and try again." |
| `MMPAY` | — | no payment status | "Say whether the sale is not paid, part paid or paid in full." |
| `42501` | — | `fn_record_order_payment` by kitchen, the accountant or a stranger | "Your role does not permit recording payments" (from `fn_require_account_role`; the app shows its own sentence, see below) |

Every `MMENT`/`MMSAL` message ends "Everything already entered is still here."
and, for a sales action, says payments on confirmed sales can still be recorded.
No refusal names an amount of money. `describeWriteError` already passes a
non-`42501` message through unchanged, so `MMPAY` sentences reach the person as
written.

## What the owner sees

Once 0066 is in, after a trial ends (or on Costing, for sales):

- Recording, correcting or cancelling a purchase, re-costing dishes, and
  confirming, cancelling or reissuing a sale are refused with the sentence
  above, instead of going through (purchases) or failing silently.
- Recording the balance a customer paid on a sale already confirmed **works**
  once the sale page calls `fn_record_order_payment` (separate web deploy,
  after 0066). Receipts then show the sale as paid.
- People: inviting, changing a role and removing someone still work.
- New trials end at 23:59:59 Lagos time on day 14, so the lock never lands in
  the middle of a service. Live trials gain up to a day.
- A staff member cannot open a business of their own with the same email.

## Order of operations

0066 is one step of the trial-and-billing drop. The whole drop, in order (the
integrator's decision X9):

| # | Step | Where | Writes? |
|---|---|---|---|
| 1 | The owner runs the read-only checks, `PRE_DEPLOY_0066.sql` among them | SQL Editor | no |
| 2 | `migrations/proposed/0065_help_videos.sql` with its PRE and POST, **only if 0065 ships**, and always before 0066 | psql | yes |
| 3 | **`migrations/proposed/0066_trial_gate.sql`**, then `POST_VERIFY_0066.sql` | **psql only**, then SQL Editor | yes |
| 4 | `migrations/proposed/0067_billing_self_serve.sql` with `PRE_DEPLOY_0067` and `POST_VERIFY_0067` (see `DEPLOY_0067.md`) | psql | yes |
| 5 | Edge functions, in this order: `paystack-webhook`, `paystack-manage`, `paystack-checkout`, `trial-reminder-mailer` | Supabase CLI | — |
| 6 | The Paystack test-mode checks | Paystack test mode | — |
| 7 | `BILLING_SELF_SERVE=on` in Vercel's environment | Vercel | — |
| 8 | The Vercel deploy (it carries the sale-page payment switch, `markPaid` → `fn_record_order_payment`) | Vercel | — |
| — | `migrations/rollbacks/0066_rollback.sql`, only if POST_VERIFY_0066 fails (and before 0067 is applied) | psql | yes |

Run `POST_VERIFY_0066.sql` straight after step 3, before 0067: its row 13
counts 102 `fn_*`, which 0067 then raises. The checks that matter after 0067
too (rows 1-12 and 14-17, and suite 052) keep passing once 0067 is in: 0067's
new `SECURITY DEFINER` functions are service-only, so the catalogue rule
(POST row 7, suite 052 row 81) does not count them.

```
psql "<session-pooler connection string>" --single-transaction -v ON_ERROR_STOP=1 \
     -f migrations/proposed/0066_trial_gate.sql
```

Expect **PRE 35/35**, `NOTICE: 0066 OK: … (N live trial(s) moved later, each
logged) …`, **POST 17/17**. N must equal PRE row 32, and POST row 15 prints the
same N. Same transaction guard as 0049–0065; it refuses the SQL Editor. After
POST passes, `git mv` the file from `proposed/` to `migrations/`.

PRE rows 6–21 print the md5 of each function 0066 replaces. 0066's preflight
holds the same values and refuses to run if any differs: then **stop** and send
the PRE output, because a copied body would undo whatever changed. Re-running
PRE after 0066 is in fails rows 2, 3, 5 and 6–21; that is expected.

POST rows 16 and 17 are information only. Row 15 checks that no trial has two
0066 history rows; that every moved trial has one is proven inside the
migration (its self-check refuses to commit otherwise) and by N matching.

PRE rows 23–35 are the Day 0 facts (counts only; nothing names a person):
history rows so far, the time zone, logins on two accounts, ended accounts with
confirmed sales still owed (and the amount, where the lines give it), trials
longer than 14 days, trials whose two dates disagree, drafts on ended accounts
(they cannot be recorded after 0066), staff of ended accounts who own nothing,
how many live trials 0066 will move and by how much, ended trials, custom
units and accounts with no subscription row. 0066 changes none of the
existing anomalies: a long trial or a self-onboarded staff login stays as it
is, to be corrected deliberately once such changes are recorded.

## App work that depends on 0066 (not in this migration)

- **Sale page** (`sales/[id]/page.tsx`): `markPaid` calls
  `rpc('fn_record_order_payment', { p_order_id, p_amount_paid, p_payment_status })`
  and the payment form shows on confirmed, not-cancelled sales for owner,
  manager and sales whatever the plan. Deploy **after** 0066; revert it
  **before** a 0066 rollback (the old direct update still works on 0064).
  It passes an `MMPAY` message through as written, and turns a `42501` from
  this call into "Your role can't record payments. Ask the owner or a
  manager." (never the subscription sentence).
- `describeWriteError` may map `MMENT`/`MMSAL` (or read `hint`); optional, the
  message already reads as English.
- The onboarding form's `friendly()` shows a generic sentence for unknown codes:
  it should show `error.message` for `MMLGN` and `MMENT`.
- Settings and dish actions that recompute after an update now get `MMENT`
  after a trial instead of a false success; check the update's row count first.

## Rollback

In the reverse of the order above: the Vercel deploy first (and
`BILLING_SELF_SERVE` off), then the edge functions, then 0067's rollback
(`DEPLOY_0067.md`), then:

```
psql "<session-pooler connection string>" --single-transaction -v ON_ERROR_STOP=1 \
     -f migrations/rollbacks/0066_rollback.sql
```

It restores the 16 functions exactly as 0064 left them (md5-checked), puts back
the 0018 units policy and drops the three new functions. **It refuses to run
while anything newer than 0066 is applied**: if any of the 16 functions is no
longer its 0066 definition, if the counts are not 102 `fn_*` / 118 policies,
or if any table, view, `fn_*` function, trigger or policy in `public` was
created after 0066's own objects. 0067 (billing self-serve) assumes 0066; roll
it back first (rehearsed: with 0067 in, this rollback refuses on the counts).
If 0065 shipped, it stays in: this rollback leaves it alone. **Not undone:**
trials 0066 moved later stay at the end of their day (moving them back would
take hours from people still trialling), and their `subscription_changes` rows
stay (the table is append only).

## 0065 and 0066 in one repository

When 0065 and its suite 051 are merged next to 0066, `tests/MANIFEST` must pin
051 to its own moment, because at a 0066 head its check 12 finds 102 `fn_*`:

```
051_help_videos.sql                   requires=0065 era=0065
```

Rehearsed in a scratch copy of this tree with 0065, 051 and the 0065 version
of 043 added: see the last rows below.

## Rehearsal results (18 Oct 2026, repository-built databases on PG 17.6)

| Item | Result |
|---|---|
| md5 of the 16 functions on a fresh 0064 build | the values baked into 0066's preflight, printed by PRE rows 6–21 and held by the rollback; the rollback's 0066 values match a fresh 0066 build |
| `PRE_DEPLOY_0066.sql` on a 0064 copy seeded with live trials (ending 14:37 Lagos, in 30 minutes, hand-edited, with NULL `trial_ends_at`, already at 23:59:59.5), an ended trial with money owed and a draft purchase, an active paid account, a cancelled account inside its paid period, a past-due account, a staff-only login, a login on two accounts and a custom unit | **35/35 PASS**; row 32: 4 trials to move, at most 17.5 hours |
| apply on that copy | `0066 OK … 4 live trial(s) moved later, each logged`. Exactly those 4 moved to 23:59:59 Lagos, each with one `trial_extended`/`owner` row; the hand-edited and NULL ones moved `current_period_end` only and their rows record only that field; the 23:59:59.5, ended, paid, cancelled and past-due rows were untouched |
| `POST_VERIFY_0066.sql` there | **17/17 PASS**; row 15 printed 4, as PRE row 32 did |
| apply without `--single-transaction` | refused by the guard; nothing left behind (99 `fn_*`, no history rows) |
| apply over a drifted function (one sentence changed in `fn_void_order`) | refused by the preflight, naming the function and both md5s |
| apply twice | refused: "a 0066 function already exists" |
| `PRE_DEPLOY_0066.sql` re-run with 0066 in | rows 2, 3, 5 and 6–21 FAIL, as this runbook says; row 22 passes |
| rollback while a newer table exists, with a replaced function changed after 0066, or with 0067 applied | refused each time, naming what it found (with 0067: "107 fn_* and 118 policies, expected 102 and 118") |
| rollback 0066 → 0064 on the seeded copy | `0066 rollback OK`; schema fingerprint (`scripts/fingerprint.sh`) **and** function ACLs, settings and comments, policy expressions, indexes, table grants and comments identical to the fresh 0064 build; re-applying 0066 afterwards `OK` with 0 trials moved, POST 17/17 |
| `tests/052_trial_gate.sql` | **83/83** |
| mutation check on a 0066 copy: the gate line removed from `fn_post_purchase`, `fn_reverse_purchase`, `fn_recompute_business_recipes` and `fn_recompute_recipes_for_ingredient`, and `fn_record_order_payment` raising `check_violation` instead of `MMPAY` | 10 rows FAIL (10, 16, 19, 22: refused by a gated function they call, not their own gate; 62, 84, 85, 87: not MMPAY; 81, 82: the catalogue rule) |
| 0067 (billing branch, as it stands) applied on top of 0066 | `0067 OK`; suite 052 83/83; POST rows 1–12 and 14–17 PASS, row 13 reads 107 `fn_*` (expected: run POST before 0067); PRE row 22 PASS, "none outside the list" (0067's new definer functions are service-only, so the catalogue rule does not count them) |
| full suite run, head = 0001→0064 + 0066 (`scripts/run_suites.ps1`, working databases named after the head) | 49 suites, **1096 pass, 0 fail**, 2 skipped by design |
| the same with `scripts/run_suites.sh` | 49 suites, **1096 pass, 0 fail**, 2 skipped |
| full suite run, head = 0064 + 0065 + 0066, with `051 requires=0065 era=0065` | 50 suites, **1108 pass, 0 fail**, 2 skipped; 051 12/12 at era 0065, 043 15/15 and 052 83/83 at head |
| on a seeded 0064 + 0065 copy | PRE 35/35 (row 4 "0065 applied"), `0066 OK … 4 live trial(s) moved later`, POST 17/17, suite 052 83/83, `0066 rollback OK` back to the 0065 schema exactly (both fingerprints identical), 0065's help row still there |
| suites changed for 0066 | `018` check 13 and `022` check 24 expect 70 entitlement-gated policies once 0066 is in (69 before); `034` check 3 adds `fn_record_order_payment` |
