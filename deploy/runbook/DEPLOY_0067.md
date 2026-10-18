# DEPLOYMENT RUNBOOK — 0067 (self-serve billing: plan change, Cancel plan, Update card)

> ## ⛔ NOT AUTHORISED UNTIL YOU RUN IT. Nothing here has touched production or Paystack.

Expected starting state: **0066_trial_gate applied** (0065 help videos before
it), 118 policies in `public`, **102** `fn_*` functions. 0067 refuses to run
without 0066.

The owner's decisions (18 Oct 2026) this ships:

- **D5. Plan changes are self-serve.** Checkout refuses only when the account
  already pays for the **same** plan (active or overdue on it). Moving to the
  other plan goes ahead. Once the new Paystack subscription is on file, the
  old one is switched off automatically and its later events are ignored, so
  nobody pays twice. No credit for unused days: the new plan starts the day
  you pay and the old one stops. An overdue account on the same plan is
  offered **Update your card**. Changing plan, cancelling and updating the
  card on a paying account are **owner only**. A trial's first payment is
  unchanged (any member may still pay).
- **D6. There is a Cancel plan button.** It stops renewal at Paystack; the plan
  stays on until the end of the period already paid; after that the account is
  read-only. Founders keep the founding price while that period runs and lose
  it when it ends (the 0050 rule, on Paystack's `subscription.disable`). No
  undo: they choose a plan again. A copy of records is still "message us".

## What changes

| | |
|---|---|
| `billing_superseded` | new table. One row per Paystack subscription a newer one replaced: account, old subscription and customer codes, the old plan, what replaced it, attempts, `disabled_at`, outcome. RLS on with **no client policy**; anon and authenticated hold nothing; service_role may only `SELECT`. `account_id` is `ON DELETE SET NULL` so a switch-off still happens if the account is deleted |
| `fn_billing_find_account(jsonb)` | new, service context only. Who an event belongs to, **exact matches only**, first answer wins: `data.metadata.account_id` → the stored `provider_subscription_code` (`data.subscription_code` or `data.subscription.subscription_code`) → a replaced code in `billing_superseded` → the **single** account holding `data.customer.customer_code`. A code on two accounts fails closed: `ambiguous_customer` / `ambiguous_subscription`. A malformed metadata id is `bad_metadata` |
| `fn_billing_claim_switch_offs(int)` | new, service only. The webhook's work list: replaced codes not yet off, **never a code that is current on any account**, claimed under `SKIP LOCKED`, backing off 2…256 min, at most 20 tries |
| `fn_billing_record_switch_off(text,text,text)` | new, service only. Records `disabled` / `already_off` / `failed`. Refuses to mark a current code off. A closed row is never reopened, so retries are idempotent. Logs `old_subscription_switched_off` to `subscription_changes` |
| `fn_billing_record_manage_request(uuid,uuid,text,text,text)` | new, service only. paystack-manage's record of an owner's cancel or card-link request (`cancel_requested` / `card_link_requested`, source `customer`). Checks again that the caller owns the account. Never stores the card link |
| `fn_billing_apply` | the 0051 body plus: attribution through `fn_billing_find_account`; any event for a **replaced** subscription is `ignored` (`superseded`; a payment on it is `superseded_charge`) and changes nothing; a renewal charge with no subscription code on a plan the account has left is `superseded_charge` (the plan never flips back); a payment that names a new subscription, or carries our `metadata.replaces`, records the old one in `billing_superseded` and writes `subscription_replaced`; the **arrival-order catch-up** (below) |
| `fn_apply_billing_side_effects` | the 0050 body, except that only a payment may **replace** the stored subscription or customer code; any other event may only fill an empty one. Reads `data.subscription.subscription_code` too. Founding confirmation and forfeiture are unchanged |
| `fn_admin_scan` + `ck_platform_alerts_kind` | the 0055 scan plus three alerts: `subscription_not_switched_off` (critical: an old subscription still live an hour after a plan change), `superseded_subscription_charged` (critical, last 14 days: a replaced subscription took a payment, refund it), `cancel_not_confirmed` (warn: an owner cancelled an hour ago and Paystack's `not_renew` has not reached us) |
| One-time code recovery | a paying account (not on trial) with a customer code that no other account shares and **no** subscription code gets the code of its own signature-verified `subscription.create` events, **only** when they name exactly one subscription. Nothing else on the row moves; no old event is re-applied. Each recovery is logged `subscription_code_recovered`. PRE row 10 says how many |
| Policies in `public` | 118 → **118** |
| `fn_*` | 102 → **106** |
| Entitlement | **unchanged**. `cancelled` stays entitled while `current_period_end > now()` (0032): that is what keeps a cancelled plan on to the end of the month paid |

### The arrival-order catch-up

Paystack sends `charge.success` (which carries our metadata) and
`subscription.create` (which does not) within seconds, in either order. For a
**brand-new** Paystack customer, a `subscription.create` processed first
matches nothing and fails `no_account`; then the subscription code is never
stored and a later plan change could not switch it off. So after an applied
payment, `fn_billing_apply` re-applies at most three `subscription.create`
events that failed `no_account` **in the last hour** and carry **exactly the
customer code now on that account**. Nothing older is ever replayed
automatically (suite 053 row 52).

### Edge functions (same release)

| Function | Change |
|---|---|
| `paystack-webhook` | after every verified delivery, switches off replaced subscriptions in the background (`EdgeRuntime.waitUntil`): `GET /subscription/:code` for `email_token`, then `POST /subscription/disable`; records each outcome. Never changes the HTTP answer to Paystack. Deploy with `--no-verify-jwt` as before |
| `paystack-checkout` | before any quote or founder hold: `already_on_plan` 409 (same tier, active or past_due), `owner_only` 403 (account already pays — active, past_due, or cancelled inside its period — and the caller is not its owner), `switch_needs_support` 409 (a live paid plan with **no** subscription code on file, so the old one could not be switched off). A plan change sends `metadata.replaces` = the code on file. Kill switch: secret `BILLING_SELF_SERVE=off` turns every live plan change into `switch_needs_support` |
| `paystack-manage` | **new**, JWT verified, owner only. `{"action":"cancel"}` and `{"action":"card_link"}`; contract in its README. Never writes the subscription row |

## Paystack facts this relies on

`paystack.com/docs` answers 403 to automated reads, so the endpoints were
confirmed on 18 Oct 2026 against Paystack's own public OpenAPI description,
`github.com/PaystackOSS/openapi` (`src/assets/openapi/paths/`):

| Fact | Source | Status |
|---|---|---|
| `GET /subscription/{code}` (Fetch Subscription) returns `data.status`, `data.subscription_code`, **`data.email_token`**, `data.next_payment_date`, `data.customer.customer_code`, `data.plan.plan_code` — and `data.authorization.authorization_code`, which we never keep | `subscription_{code}.yaml`, `SubscriptionFetchResponse.yaml` | confirmed |
| `POST /subscription/disable` takes `code` and `token` (the email token), JSON or form | `subscription_disable.yaml`, `SubscriptionToggle.yaml` | confirmed |
| `GET /subscription/{code}/manage/link` "Generate a link for updating the card on a subscription"; `POST /subscription/{code}/manage/email` emails it instead | `subscription_{code}_manage_link.yaml` | endpoint confirmed. **The response field is not in the spec** (generic Ok); we read `data.link` and fail closed (`paystack_error`) if it is missing or not an https Paystack page. **Confirm in test mode (T6)** |
| Disable emits `subscription.not_renew` now and `subscription.disable` at the period end; failed charges are not retried; there is no plan-switch call | `docs/D13_PAYSTACK_RESEARCH.md` §7 (owner-verified 27 Aug 2026) | relied on. If test mode shows `subscription.disable` arriving **at once**, a founder who cancels loses the founding price at once (access still runs to the period end): tell the owner before the button ships |
| Subscription events carry `data.subscription_code` and `data.customer.customer_code`; invoice events carry `data.subscription.subscription_code` | third-party write-ups only | 0067 reads all of these and needs none of them to carry our metadata. **Confirm in test mode (T1, T2)** |

## Order of operations

| # | Step | Where | Writes? |
|---|---|---|---|
| 0 | Rehearse T1-T8 below against a **test-mode** project (sk_test key) | test project | test only |
| 1 | `PRE_DEPLOY_0067.sql` | SQL Editor | no |
| 2 | `migrations/proposed/0067_billing_self_serve.sql` | **psql only** | yes |
| 3 | `POST_VERIFY_0067.sql` | SQL Editor | no |
| 4 | `supabase functions deploy paystack-webhook --no-verify-jwt` | CLI | — |
| 5 | `supabase functions deploy paystack-manage` | CLI | — |
| 6 | `supabase functions deploy paystack-checkout` | CLI | — |
| 7 | Vercel deploy of the web changes (`/api/billing`, Cancel plan, Update your card, the plan chooser's new messages) | Vercel | — |

```
psql "<session-pooler connection string>" --single-transaction -v ON_ERROR_STOP=1 \
     -f migrations/proposed/0067_billing_self_serve.sql
```

Expect **PRE 12/12** (row 1 says 0066 is in), `NOTICE: 0067 recovery: N …`,
`NOTICE: 0067 OK: …`, **POST 12/12**. Same transaction guard as 0049-0066.
After POST passes, `git mv` the file from `proposed/` to `migrations/`.

**The order matters.** Step 6 must come after steps 2 and 4: the new checkout
lets a paying owner open a second subscription, and only 0067 plus the new
webhook switch the first one off. Step 7 must come after step 5. Steps 4 and
5 are harmless before 2 (their calls to the new functions fail and are
logged), but there is no reason to do that.

## Test-mode rehearsal (step 0)

| | Do | Expect |
|---|---|---|
| T1 | A trial account pays for Costing | `charge.success` applied `via metadata`; `subscription.create` applied `via customer_code` (or caught up); `provider_subscription_code` stored |
| T2 | The owner moves to Costing + Sales | checkout sends `metadata.replaces`; within a minute `billing_superseded` shows the old code with `disabled_at` set; the Paystack dashboard shows **one** active subscription for that customer; the old one's `not_renew` / `disable` arrive as `ignored` / `superseded`; the account stays `active` on the new plan; a founder keeps the founding price |
| T3 | The owner picks the plan they are on | `409 already_on_plan`, and no new `founder_slots` hold |
| T4 | A manager on that account picks either plan | `403 owner_only` |
| T5 | The owner presses Cancel plan | `200 ends_on` = the period end; `not_renew` makes the row `cancelled` with `cancel_at_period_end`; still entitled; **note when `subscription.disable` arrives** |
| T6 | The owner asks for Update your card | `200 link`, an https page on paystack.com; **record the response field name** |
| T7 | Cancel again | `409 nothing_to_cancel` |
| T8 | A cancelled (non-renewing) owner chooses a plan again before the period ends | goes ahead; the old code is recorded `already_off` without a second disable |

## After deploy: what to watch

```sql
-- replaced subscriptions not yet off (should empty within minutes)
select subscription_code, account_id, attempts, last_error, recorded_at
  from billing_superseded where disabled_at is null order by recorded_at;
-- the three new alerts
select kind, subject, severity, summary, first_seen from platform_alerts
 where resolved_at is null and kind in ('subscription_not_switched_off',
       'superseded_subscription_charged','cancel_not_confirmed');
```

**An old subscription that will not switch off** (`subscription_not_switched_off`):
open it in the Paystack dashboard and disable it there, then record it so the
alert clears (the SQL Editor runs as service context):

```sql
select fn_billing_record_switch_off('<SUB_code>', 'already_off', 'switched off by hand in the Paystack dashboard');
```

If the alert says the old code **is still the one on file**, the new
subscription's own `subscription.create` never reached us: find it (below),
re-apply it, and the next delivery switches the old one off.

**A replaced subscription took a payment** (`superseded_subscription_charged`):
the customer was charged twice. Refund that charge from the Paystack
dashboard under the refunds page's "charged twice" rule, switch the old
subscription off as above, and resolve the alert with a note.

**Accounts with two or more subscription codes** (PRE row 10): 0067 leaves
them alone. In the Paystack dashboard, find which subscription is live; if
both are, disable the one that is not their current plan and refund any
double charge. Then put the live code on file:

```sql
begin;
update subscriptions set provider_subscription_code = '<SUB_live>'
 where account_id = '<account uuid>' and provider_subscription_code is null;   -- expect UPDATE 1
insert into subscription_changes (subscription_id, account_id, change_kind, previous_values,
       new_values, change_source, authorised_by, reason)
select id, account_id, 'subscription_code_set_by_hand', '{"provider_subscription_code":null}',
       jsonb_build_object('provider_subscription_code', '<SUB_live>'), 'owner', '<your name>',
       'set the live Paystack subscription code after checking the dashboard'
  from subscriptions where account_id = '<account uuid>';
commit;
```

Until a code is on file, a paying account's owner is told
`switch_needs_support` ("message us") instead of being able to switch.

### Old `no_account` events: reviewed, one at a time, never in bulk

0067 attributes **new** events. Events that failed `no_account` before it stay
failed (PRE row 8), because replaying them could cancel or flip an account,
or move a period backwards. To review them:

```sql
select e.id, e.event_type, e.received_at,
       fn_billing_find_account(e.payload) as would_match,
       e.payload #>> '{data,next_payment_date}' as next_payment_date,
       s.status, s.plan_id, s.current_period_end
  from billing_events e
  left join subscriptions s
    on s.account_id = (fn_billing_find_account(e.payload)->>'account_id')::uuid
 where e.status = 'failed_permanent' and e.last_error_code = 'no_account'
 order by s.account_id, e.received_at desc;
```

Re-apply only the **newest** event per account, and only when its effect is
the one you expect: a `not_renew` or `disable` for an account still `active`
(it stopped paying and we never heard), or a `subscription.create` whose
`next_payment_date` is **not earlier** than the current period end. Do it in
a transaction and look before you commit:

```sql
begin;
update billing_events set status = 'processing' where id = '<event id>' and status = 'failed_permanent';
select fn_billing_apply('<event id>');
select status, plan_id, current_period_end, cancel_at_period_end, provider_subscription_code
  from subscriptions where account_id = '<account uuid>';
commit;   -- or rollback;
```

## Rollback

In this order:

1. **Stop new plan changes first:** `supabase secrets set BILLING_SELF_SERVE=off`
   (paystack-checkout then answers `switch_needs_support` for every live paid
   plan change; a trial's first payment is unaffected). Revert the Vercel
   deploy so the Cancel plan and Update card buttons go.
2. `supabase functions delete paystack-manage`.
3. Wait until `billing_superseded` has no row with `disabled_at` null, or
   switch those off in the Paystack dashboard and record them (above).
4. `migrations/rollbacks/0067_rollback.sql` with psql `--single-transaction`.
   It **refuses** while a replaced subscription is not recorded as off, and
   lists the codes.
5. Redeploy `paystack-webhook` and `paystack-checkout` from the commit before
   this one. Keep `BILLING_SELF_SERVE=off` until the web no longer offers a
   plan change to a paying account.

The rollback restores the three function bodies byte for byte (md5 checked),
drops the table and the four functions, and keeps: recovered and stored
subscription codes, every `subscription_changes` row (append-only),
`ignored` billing events, and any alert rows of the new kinds (the kind check
is then re-added `NOT VALID`).

## Rehearsal results (18 Oct 2026, repository-built databases on PG 17.6)

This worktree has no 0066 (another builder's), so the rehearsal ran 0067 on
0064; on that sequence `fn_*` goes 99 → 103. POST row 9 was run with 106
replaced by 103 for that reason; as written it expects the production
sequence's 106 and fails on 103, as it should.

| Item | Result |
|---|---|
| `PRE_DEPLOY_0067.sql` on a seeded 0064 copy | 12/12 PASS (row 1 "NOT YET: apply 0066 first"; row 10 "1 recoverable, 1 with two or more codes") |
| apply without `--single-transaction` | refused by the guard |
| apply in production mode (`mm.fresh_install` off) on 0064 | refused: "fn_require_entitled is missing. Apply 0066_trial_gate first." |
| apply on the seeded copy | `0067 recovery: 1 subscription code(s) recovered; 1 account(s) with more than one subscription code left alone`; `0067 OK … 103 fn_* (+4), 118 policies` |
| `POST_VERIFY_0067.sql` (106→103) | 12/12 PASS |
| rollback with a replaced subscription not yet off | refused, listing the code |
| rollback after recording it, with a 0067-kind alert row present | OK; kind check re-added NOT VALID |
| clean apply → rollback → schema dump vs the 0064 build | identical |
| `tests/053_billing_self_serve.sql` | **52/52** |
| full suite run (the `scripts/run_suites.ps1` logic, template `mmb2` = 0001→0064 + 0067) | 49 suites, **1065 pass, 0 fail**, 2 skipped by design (003, 008). 036 (checkout and founder payment) passes unchanged at head under the new attribution |
| Deno: `paystack-webhook` / `paystack-checkout` / `paystack-manage` | 23 / 32 / 18 passed, 0 failed; `deno check index.ts` clean in each |
