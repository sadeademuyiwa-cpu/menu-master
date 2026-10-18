# DEPLOYMENT RUNBOOK — 0066 (the trial gate: after a trial, nothing new is saved except money received)

> ## ⛔ NOT AUTHORISED UNTIL YOU RUN IT. Nothing here has touched production.

Expected starting state: **0064 applied** (0065 help videos may or may not be
in; 0066 does not need it), 118 policies in `public`, 99 `fn_*` functions.
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
| `fn_record_order_payment(uuid, numeric, payment_status)` | **new.** Owner, manager or sales; confirmed, not cancelled sales only; amount ≥ 0; changes `amount_paid` and `payment_status` and nothing else. No trial or plan check (D2). |
| `fn_create_account_and_business` | **replaced**, same signature and grants. For anyone but the operator: `p_trial_days` other than 14 (NULL included) → `22023`; a login that is already staff somewhere → **`MMLGN`**; adding a business to an account without access → `MMENT`. The trial row now goes in **before** the starter catalogue (which is now gated) and ends at `fn_trial_end(now())`. A retried onboarding still replays first. The operator keeps `p_trial_days` and multi-account creation. |
| `fn_guard_subscription_writes` | **replaced.** A trial made outside service context must end at `fn_trial_end(now())`, with `trial_ends_at = current_period_end`. |
| `fn_my_entitlement_status` | **replaced**, same columns: it now names the caller's **oldest** membership, as `fn_my_has_sales` and the app already do. |
| `p_units_write` on `units` | **replaced under the same name** (`for all to authenticated`): adds owner/manager/kitchen and `fn_account_is_entitled`. Reads are unchanged (`p_units_read_own`). |
| live trials | moved to 23:59:59 Lagos on their last day, only ever later; one `subscription_changes` row each: `change_kind` `trial_extended`, `change_source` `owner`, `authorised_by` "Owner decision D1, trial plan of 18 Oct 2026", reason starting "0066:". |
| Policies in `public` | 118 → **118** |
| `fn_*` | 99 → **102** |
| Left open on purpose | member management (`fn_invite_member`, `fn_accept_invitations`, `fn_set_member_role`, `fn_remove_member`, `fn_revoke_invitation`), platform admin, reads. |

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

Every `MMENT`/`MMSAL` message ends "Everything already entered is still here."
and, for a sales action, says payments on confirmed sales can still be recorded.
None names an amount of money. `describeWriteError` already passes a non-`42501`
message through unchanged.

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

| # | Artefact | Where | Writes? |
|---|---|---|---|
| 1 | `PRE_DEPLOY_0066.sql` | SQL Editor | no |
| — | `migrations/proposed/0065_help_videos.sql`, if it is ready | psql | yes |
| 2 | `migrations/proposed/0066_trial_gate.sql` | **psql only** | yes |
| 3 | `POST_VERIFY_0066.sql` | SQL Editor | no |
| 4 | Vercel deploy of the sale-page payment switch (`markPaid` → `fn_record_order_payment`) | Vercel | — |
| — | `migrations/rollbacks/0066_rollback.sql`, only if 3 fails | psql | yes |

```
psql "<session-pooler connection string>" --single-transaction -v ON_ERROR_STOP=1 \
     -f migrations/proposed/0066_trial_gate.sql
```

Expect **PRE 35/35**, `NOTICE: 0066 OK: … (N live trial(s) moved later, each
logged) …`, **POST 17/17**. N must equal PRE row 32. Same transaction guard as
0049–0065; it refuses the SQL Editor. After POST passes, `git mv` the file from
`proposed/` to `migrations/`.

PRE rows 6–21 print the md5 of each function 0066 replaces. 0066's preflight
holds the same values and refuses to run if any differs: then **stop** and send
the PRE output, because a copied body would undo whatever changed. Re-running
PRE after 0066 is in fails rows 2, 3 and 5–22; that is expected.

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
- `describeWriteError` may map `MMENT`/`MMSAL` (or read `hint`); optional, the
  message already reads as English.
- The onboarding form's `friendly()` shows a generic sentence for unknown codes:
  it should show `error.message` for `MMLGN` and `MMENT`.
- Settings and dish actions that recompute after an update now get `MMENT`
  after a trial instead of a false success; check the update's row count first.

## Rollback

Revert the web deploy first, then:

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
it back first. **Not undone:** trials 0066 moved later stay at the end of their
day (moving them back would take hours from people still trialling), and their
`subscription_changes` rows stay (the table is append only).

## Rehearsal results (18 Oct 2026, repository-built databases on PG 17.6)

| Item | Result |
|---|---|
| md5 of the 16 functions on a fresh 0064 build | the values baked into 0066's preflight and printed by PRE rows 6–21 |
| `PRE_DEPLOY_0066.sql` on a 0064 copy seeded with live, ended, hand-edited and paid trials, money owed on an ended account, a staff login and a login on two accounts | **35/35 PASS**; row 32: 3 trials to move, at most 21.7 hours |
| apply on that copy | `0066 OK … 3 live trial(s) moved later, each logged`. A trial ending 14:37 Lagos moved to 23:59:59; one already at 23:59:59.5 was left alone; the ended trial and the paid account were untouched; the hand-edited trial moved `current_period_end` only and its row records only that field |
| `POST_VERIFY_0066.sql` there | **17/17 PASS** |
| apply without `--single-transaction` | refused by the guard; nothing left behind |
| apply over a drifted function (one word changed in `fn_void_order`) | refused by the preflight, naming the function and both md5s |
| apply twice | refused: "a 0066 function already exists" |
| on top of 0065 (help videos) | PRE 35/35 (row 4 "0065 applied"), `0066 OK`, POST 17/17, suite 052 79/79, rollback OK |
| `tests/052_trial_gate.sql` | **79/79** |
| mutation check: 052 with `fn_void_order` and `p_units_write` put back as 0064 left them | 8 rows FAIL, as they should |
| rollback while a newer table exists, or with a replaced function changed after 0066 | refused, naming what it found |
| rollback 0066 → 0064 | `0066 rollback OK`; schema fingerprint (columns, constraints, indexes, policies, functions, views, grants, triggers, comments) identical to the fresh 0064 build; re-applying 0066 afterwards `OK` with 0 trials moved |
| full suite run, head = 0001→0064 + 0066 (`run_suites.ps1` logic, prefixed databases) | 49 suites, **1092 pass, 0 fail**, 2 skipped by design (baseline at 0064: 48 suites, 1013 pass) |
| suites changed for 0066 | `018` check 13 and `022` check 24 expect 70 entitlement-gated policies once 0066 is in (69 before); `034` check 3 adds `fn_record_order_payment`. No suite needed an `era=` pin: none at head asserts the `fn_*` total |
