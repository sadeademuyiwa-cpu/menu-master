# DEPLOYMENT RUNBOOK — 0067 (self-serve billing: plan change, Pay now, Cancel plan, Update card)

> ## ⛔ NOT AUTHORISED UNTIL YOU RUN IT. Nothing here has touched production or Paystack.

Expected starting state: **0066_trial_gate applied**, and 0065 (help videos)
before it if 0065 ships at all (its checks expect 99 `fn_*`, so it must go in
before 0066). 118 policies in `public`, **102** `fn_*` functions. 0067 refuses
to run without 0066. After it: 118 policies, **107** `fn_*`.

The decisions (18 Oct 2026) this ships:

- **D5. Plan changes are self-serve.** Checkout refuses only when an
  **active** account picks the plan it is already on. Moving to the other
  plan goes ahead. Once the new Paystack subscription is on file, the old one
  is switched off automatically and its later events are ignored, so nobody
  pays twice. No credit for unused days: the new plan starts the day you pay
  and the old one stops. Changing plan, cancelling and updating the card on a
  paying account are **owner only**. A trial's first payment is unchanged (any
  member may still pay).
- **D6. There is a Cancel plan button.** It stops renewal at Paystack; the plan
  stays on until the end of the period already paid; after that the account is
  read-only. Founders keep the founding price while that period runs and lose
  it when it ends (the 0050 rule, on Paystack's `subscription.disable`). No
  undo: they choose a plan again.
- **X1. An overdue owner can cancel.** `paystack-manage` accepts Cancel plan
  from a `past_due` account (with a code on file). Its paid period is already
  over, so recording stops straight away; the reply's `ends_on` is `null`.
  Founders always lose the founding price when the plan ends.
- **X2. An overdue owner can pay again on the same plan ("Pay now").**
  `already_on_plan` is for an **active** account only. A `past_due` account
  choosing its own tier goes ahead as a **replacement** of the failed
  subscription (`metadata.replaces` = the code on file, exactly like a tier
  change), so the webhook switches the failed one off after the new payment.
  With no code on file it is `switch_needs_support`. Paystack does not retry a
  failed subscription charge (D13 P-3), so Update your card alone may never
  collect the month.
- **X3.** `paystack-manage` answers **`change_in_progress`** (409) to Cancel
  plan and Update your card while a plan change is still finishing (the old
  subscription is still the one on file and is waiting to be switched off).
  `paystack-checkout` gives the same answer to a second plan change or Pay now
  in that window, so a second paid checkout cannot replace the same old
  subscription and leave two new ones charging (the web already words it:
  "Your plan change is still finishing. Try again in a minute.").
- **X4.** The web shows self-serve billing for an already-paying account only
  when the Vercel variable `BILLING_SELF_SERVE` is exactly `on` (web release).
  The edge function's own kill switch (`BILLING_SELF_SERVE=off` as a Supabase
  secret) is separate and stays as built.
- **X8.** A `not_renew` is recorded as status `cancelled` with
  `cancel_at_period_end` and access until `current_period_end` (0032). Such an
  account may choose a plan again, its own included: a new paid month starts
  that day and the ending subscription simply ends.

## What changes

| | |
|---|---|
| `billing_superseded` | new table. One row per Paystack subscription a newer one replaced: account, old subscription and customer codes, the old plan, what replaced it, attempts, `disabled_at`, outcome. RLS on with **no client policy**; anon and authenticated hold nothing; service_role may only `SELECT`. `account_id` is `ON DELETE SET NULL` so a switch-off still happens if the account is deleted |
| `fn_billing_event_sub_code(jsonb)` | new. **The one place** a subscription code is read from an event: `data.subscription_code`, then `data.subscription.subscription_code`, then `data.plan.subscription_code`. Immutable, reads no table. Used by attribution, apply, the side effects, the recovery and the alerts, so none of them can disagree about which subscription an event is for |
| `fn_billing_find_account(jsonb)` | new, service context only. Who an event belongs to, **exact matches only**, first answer wins: `data.metadata.account_id` → the stored `provider_subscription_code` → a replaced code in `billing_superseded` → the **single** account holding `data.customer.customer_code`. A code on two accounts fails closed: `ambiguous_customer` / `ambiguous_subscription`. A malformed metadata id is `bad_metadata` |
| `fn_billing_claim_switch_offs(int)` | new, service only. The webhook's work list: replaced codes not yet off, **never a code that is current on any account**, claimed under `SKIP LOCKED`, backing off 2…256 min, at most 20 tries |
| `fn_billing_record_switch_off(text,text,text)` | new, service only. Records `disabled` / `already_off` / `failed`. Refuses to mark a current code off. A closed row is never reopened, so retries are idempotent. Logs `old_subscription_switched_off` to `subscription_changes` |
| `fn_billing_record_manage_request(uuid,uuid,text,text,text)` | new, service only. paystack-manage's record of an owner's cancel or card-link request (`cancel_requested` / `card_link_requested`, source `customer`). Checks again that the caller owns the account. Never stores the card link |
| `fn_billing_apply` | the 0051 body plus: attribution through `fn_billing_find_account`; **which events may do what** (next table); the left-plan guard; a payment that names a new subscription, or carries our `metadata.replaces`, records the old one in `billing_superseded` and writes `subscription_replaced`; the **arrival-order catch-up** (below) |
| `fn_apply_billing_side_effects` | the 0050 body, except that only a payment may **replace** the stored subscription or customer code (any other event may only fill an empty one), and a code that is in `billing_superseded` is **never stored again**. Founding confirmation and forfeiture are unchanged |
| `fn_admin_scan` + `ck_platform_alerts_kind` | the 0055 scan plus four alerts: `subscription_not_switched_off` (critical: an old subscription still live an hour after a plan change), `superseded_subscription_charged` (critical, last 14 days: a replaced subscription took a payment, refund it), `cancel_not_confirmed` (warn: an owner cancelled an hour ago, or Paystack said it was already off, and our row still renews or is still `past_due`), `possible_double_charge` (warn, last 14 days, below). The two event-based kinds stay resolved once a person resolves them |
| One-time code recovery | a paying account (not on trial) with a customer code that no other account shares and **no** subscription code gets the code of its own signature-verified `subscription.create` events, **only** when they name exactly one subscription. Nothing else on the row moves; no old event is re-applied. Each recovery is logged `subscription_code_recovered`. PRE row 10 says how many |
| Policies in `public` | 118 → **118** |
| `fn_*` | 102 → **107** |
| Entitlement | **unchanged**. `cancelled` stays entitled while `current_period_end > now()` (0032): that is what keeps a cancelled plan on to the end of the month paid |

### Which events may do what

An event is matched to an **account** first; what it may then do depends on
the **subscription** it names (`fn_billing_event_sub_code`).

| The event names | A payment (`charge.success`, `subscription.create`) | A cancel or failed payment (`subscription.not_renew`, `subscription.disable`, `invoice.payment_failed`) |
|---|---|---|
| the code on file | applied | applied |
| a **replaced** code (any account's) | `ignored`, `superseded_charge`: raised for a refund | `ignored`, `superseded`: changes nothing |
| **another** code | applied: moves the account onto it and records the old one as replaced | **`failed_permanent`, `not_current_subscription`** — changes nothing; raised as `billing_failed_permanent` for review |
| a code, and **none is on file** | applied: stores it | **`failed_permanent`, `subscription_not_on_file`** — changes nothing; review |
| no code, our metadata names the account | applied (as 0051) | applied (as 0051) |
| no code, found only by customer code | applied | **`failed_permanent`, `no_subscription_code`** — review |

So a duplicate subscription switched off by hand, an old one, or another
subscription of the same Paystack customer can never cancel the account,
forfeit the founding price or make it `past_due`.

**The left-plan guard.** A `charge.success` on a plan the account has left (a
replaced subscription on that plan exists) is `ignored` as
`superseded_charge`, however it was matched — by customer code or by
metadata Paystack may have copied from the first checkout onto a renewal
(T9). The one exception is a genuine new checkout back to that plan: its
`metadata.replaces` is the **current** code.

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

### possible_double_charge

Raised (warn) when, in the last 14 days:

- (a) an account has **two applied charges within an hour** (a double click on
  a first payment, a quick second checkout);
- (b) **two applied charges both replace the same subscription**, however far
  apart (two plan checkouts opened before the first was paid);
- (c) a subscription is **replaced within an hour of its first payment**.

The subject is the second payment's event, so one incident raises one alert.
It can be a deliberate quick upgrade: check the Paystack dashboard, and refund
only a payment the customer did not mean. Resolve it with a note; it stays
resolved.

### Edge functions (same release)

| Function | Change |
|---|---|
| `paystack-webhook` | after every verified delivery, switches off replaced subscriptions in the background (`EdgeRuntime.waitUntil`): `GET /subscription/:code` for `email_token`, then `POST /subscription/disable`; records each outcome. Never changes the HTTP answer to Paystack. Deploy with `--no-verify-jwt` as before |
| `paystack-checkout` | before any quote or founder hold: `already_on_plan` 409 (same tier, **active**), `owner_only` 403 (account already pays — active, past_due, or cancelled inside its period — and the caller is not its owner), `switch_needs_support` 409 (active or past_due with **no** subscription code on file, so the old one could not be switched off; or the kill switch is on). A plan change, an overdue Pay now (X2) and a cancelled plan chosen again (X8) send `metadata.replaces` = the code on file. `change_in_progress` 409 (X3) while that code is a `billing_superseded` row not yet off (an earlier change is still finishing); read only while the kill switch is open, so after a 0067 rollback it never reads the dropped table. Kill switch: Supabase secret `BILLING_SELF_SERVE=off` turns every live change into `switch_needs_support`; a trial's first payment is never affected |
| `paystack-manage` | **new**, JWT verified, owner only. `{"action":"cancel"}` (active or **past_due**; `ends_on` the Lagos period end, `null` when overdue) and `{"action":"card_link"}`; `change_in_progress` 409 while a `billing_superseded` row not yet off names the code on file. Contract in its README. Never writes the subscription row |
| `platform-alert-mailer` | readable words for the four new alert kinds (X7). Until it is redeployed they read as their raw names |

## Paystack facts this relies on

`paystack.com/docs` answers 403 to automated reads, so the endpoints were
confirmed on 18 Oct 2026 against Paystack's own public OpenAPI description,
`github.com/PaystackOSS/openapi` (`src/assets/openapi/paths/`):

| Fact | Source | Status |
|---|---|---|
| `GET /subscription/{code}` (Fetch Subscription) returns `data.status`, `data.subscription_code`, **`data.email_token`**, `data.next_payment_date`, `data.customer.customer_code`, `data.plan.plan_code` — and `data.authorization.authorization_code`, which we never keep | `subscription_{code}.yaml`, `SubscriptionFetchResponse.yaml` | confirmed |
| `POST /subscription/disable` takes `code` and `token` (the email token), JSON or form | `subscription_disable.yaml`, `SubscriptionToggle.yaml` | confirmed |
| `GET /subscription/{code}/manage/link` "Generate a link for updating the card on a subscription" | `subscription_{code}_manage_link.yaml` | endpoint confirmed. **The response field is not in the spec**; we read `data.link` and fail closed (`paystack_error`) if it is missing or not an https Paystack page. **Confirm in test mode (T6)** |
| Disable emits `subscription.not_renew` now and `subscription.disable` at the period end; failed charges are not retried; there is no plan-switch call | `docs/D13_PAYSTACK_RESEARCH.md` §7 (owner-verified 27 Aug 2026) | relied on. If test mode shows `subscription.disable` arriving **at once**, a founder who cancels loses the founding price at once (access still runs to the period end): tell the owner before the button ships |
| Subscription events carry `data.subscription_code` and `data.customer.customer_code`; invoice events carry `data.subscription.subscription_code` | third-party write-ups only | 0067 reads all of these (and `data.plan.subscription_code`) and needs none of them to carry our metadata. **Confirm in test mode (T1, T2, T9)** |
| What a **renewal** `charge.success` carries: our first checkout's metadata? a subscription code? | not documented | **Confirm in test mode (T9)**. 0067 is safe either way (the left-plan guard holds however the renewal is matched), but the answer decides how renewals are attributed |

## Order of operations (X9)

| # | Step | Where | Writes? |
|---|---|---|---|
| 1 | The owner runs the read-only checks: `PRE_DEPLOY_0065.sql` (if 0065 ships), `PRE_DEPLOY_0066.sql`, `PRE_DEPLOY_0067.sql` | SQL Editor | no |
| 2 | Apply 0065 (if it ships) with its PRE and POST (`DEPLOY_0065.md`) | psql | yes |
| 3 | Apply 0066 with its PRE and POST (`DEPLOY_0066.md`) | psql | yes |
| 4 | `PRE_DEPLOY_0067.sql`, then `migrations/proposed/0067_billing_self_serve.sql`, then `POST_VERIFY_0067.sql` | psql / SQL Editor | yes |
| 5 | `supabase functions deploy paystack-webhook --no-verify-jwt` | CLI | — |
| 6 | `supabase functions deploy paystack-manage` | CLI | — |
| 7 | `supabase functions deploy paystack-checkout` | CLI | — |
| 8 | `supabase functions deploy trial-reminder-mailer` (0066's release) | CLI | — |
| 9 | The Paystack test-mode checks T1-T13 (below), with the `sk_test` key. Do not go on unless every one behaves as written | test mode | test only |
| 10 | Set `BILLING_SELF_SERVE=on` in Vercel (Production) | Vercel | — |
| 11 | Vercel deploy of the web release (`/api/billing`, Cancel plan, Pay now, Update your card, the plan chooser's messages) | Vercel | — |

`platform-alert-mailer` can be redeployed any time after step 4 (labels only).

```
psql "<session-pooler connection string>" --single-transaction -v ON_ERROR_STOP=1 \
     -f migrations/proposed/0067_billing_self_serve.sql
```

Expect **PRE 12/12** (row 1 says 0066 is in), `NOTICE: 0067 recovery: N …`,
`NOTICE: 0067 OK: … 107 fn_* (+5), 118 policies`, **POST 13/13**. Same
transaction guard as 0049-0066. After POST passes, `git mv` the file from
`proposed/` to `migrations/`.

**The order matters.** Step 7 must come after steps 4 and 5: the new checkout
lets a paying owner open a second subscription, and only 0067 plus the new
webhook switch the first one off. Steps 5 and 6 are harmless before 4 (their
calls to the new functions fail and are logged), but there is no reason to do
that. Until step 10 the web hides self-serve from paying accounts (X4); if you
want the edge to refuse it too while you run step 9, set the Supabase secret
`BILLING_SELF_SERVE=off` before step 7 and remove it after step 9.

## Test-mode checks (step 9)

| | Do | Expect |
|---|---|---|
| T1 | A trial account pays for Costing | `charge.success` applied `via metadata`; `subscription.create` applied `via customer_code` (or caught up); `provider_subscription_code` stored. **Record where each event carries the subscription code** |
| T2 | The owner moves to Costing + Sales | checkout sends `metadata.replaces`; within a minute `billing_superseded` shows the old code with `disabled_at` set; the Paystack dashboard shows **one** active subscription for that customer; the old one's `not_renew` / `disable` arrive as `ignored` / `superseded`; the account stays `active` on the new plan; a founder keeps the founding price |
| T3 | The owner (active) picks the plan they are on | `409 already_on_plan`, and no new `founder_slots` hold |
| T4 | A manager on that account picks either plan | `403 owner_only` |
| T5 | The owner presses Cancel plan | `200 ends_on` = the period end; `not_renew` makes the row `cancelled` with `cancel_at_period_end`; still entitled; **note when `subscription.disable` arrives** |
| T6 | The owner asks for Update your card | `200 link`, an https page on paystack.com; **record the response field name** |
| T7 | Cancel again | `409 nothing_to_cancel` |
| T8 | The cancelled (non-renewing) owner chooses a plan again before the period ends | goes ahead, a new paid month from today; the old code is recorded `already_off` without a second disable |
| T9 | Let a test subscription **renew** (a test plan with the shortest interval test mode allows) | **Do renewal `charge.success` events carry metadata or a subscription code?** Look at the stored payload: `data.metadata` (a copy of the first checkout's?), `data.subscription_code`, `data.subscription`, `data.plan.subscription_code`. Write the answer here. Either way the renewal must be `applied` to the current plan, and a renewal of a **replaced** subscription must be `ignored` `superseded_charge` (the plan never flips back) |
| T10 | X2: make a renewal fail (a test card that declines) so the account is `past_due`; the owner chooses the **same** plan | checkout goes ahead with `metadata.replaces` = the failed code; after payment the account is `active` with a new period; the failed subscription is switched off; **one** active subscription in the dashboard |
| T11 | X1: on another `past_due` test account the owner presses Cancel plan | `200`, `ends_on: null`; the arriving `disable` / `not_renew` makes the row `cancelled`; recording stops at once; a founder's founding price is forfeited |
| T12 | X3: during a plan change (T2), press Cancel plan or Update your card, or choose a plan again, in a second tab before the new `subscription.create` lands | `409 change_in_progress` from paystack-manage and from paystack-checkout. The window is seconds; if you cannot catch it, suite 053 row 121 and the paystack-manage and paystack-checkout tests cover it |
| T13 | Disable a **second** test subscription of a paying test customer in the dashboard **without** recording it first | its `not_renew` / `disable` arrive `failed_permanent` `not_current_subscription`; the account is unchanged; `billing_failed_permanent` is raised. Close that event as reviewed (below). Then, with another such duplicate, do it the right way (record it first, below) and see `ignored` / `superseded` |

## After deploy: what to watch

```sql
-- replaced subscriptions not yet off (should empty within minutes)
select b.subscription_code, b.account_id, b.attempts, b.last_error, b.recorded_at,
       exists (select 1 from subscriptions s where s.provider_subscription_code = b.subscription_code) as is_current
  from billing_superseded b where b.disabled_at is null order by b.recorded_at;
-- the new alerts, and events held for review
select kind, subject, severity, summary, first_seen from platform_alerts
 where resolved_at is null and kind in ('subscription_not_switched_off','superseded_subscription_charged',
       'cancel_not_confirmed','possible_double_charge','billing_failed_permanent');
select id, event_type, account_id, last_error_code, last_error, received_at from billing_events
 where status = 'failed_permanent'
   and last_error_code in ('not_current_subscription','subscription_not_on_file','no_subscription_code')
 order by received_at desc;
```

### Manual switch-off sweep

The webhook retries a failed switch-off only when the **next** Paystack notice
arrives. On a quiet day that can be hours or days, and the old subscription
could renew first. So once a day while any row is pending, and whenever
`subscription_not_switched_off` is open:

1. Run the first query above.
2. For each row with **`is_current = false`** recorded more than 10 minutes
   ago: Paystack dashboard → Subscriptions → search the code. If it is Active
   (or Attention), disable it there. Then record it:

   ```sql
   select fn_billing_record_switch_off('<SUB_code>', 'disabled',
          'switched off by hand in the Paystack dashboard, <date>, <your name>');
   ```

   If Paystack already shows it Non-renewing, Cancelled or Complete, record
   `'already_off'` instead. (The SQL Editor runs as service context.)
3. **Never** disable a row with `is_current = true`: that is the subscription
   the account pays with today. It means the new subscription's own
   `subscription.create` never reached us: find it in the dashboard and in
   `billing_events` (`last_error_code = 'no_account'`), re-apply it by the
   one-at-a-time procedure below, and the next delivery switches the old one
   off.

### A replaced subscription took a payment (`superseded_subscription_charged`)

The customer was charged twice. Refund that charge from the Paystack
dashboard under the refunds page's "charged twice" rule, switch the old
subscription off as above, and resolve the alert with a note. It stays
resolved.

### possible_double_charge

Open the account's charges in the Paystack dashboard. A deliberate quick
upgrade needs nothing; a double click or two paid checkouts needs a refund of
the one not meant (and if two subscriptions are live, the sweep above). Resolve
with a note saying which.

### A cancel or failed payment held for review

`not_current_subscription`, `subscription_not_on_file` and
`no_subscription_code` events changed nothing. Look each one up in the Paystack
dashboard (customer → subscriptions):

- **A duplicate or old subscription** of that customer (the usual case): record
  it as replaced (next section, step 2 only) so its later events are ignored, then
  close the event as reviewed — by its id, one at a time:

  ```sql
  update billing_events
     set status = 'ignored',
         last_error = last_error || ' -- reviewed <date> <your name>: not the plan they pay with'
   where id = '<event id>' and status = 'failed_permanent';   -- expect UPDATE 1
  ```

- **It is the subscription the account really pays with** and **no** code is
  on file (`subscription_not_on_file`): put that code on file (next section,
  step 1), then re-apply the event by the one-at-a-time procedure below. It
  then takes effect (suite 053 rows 94-95).
- **It is the subscription the account really pays with** and a **different,
  dead** code is on file (`not_current_subscription`; the dashboard shows the
  code on file is already off and the event's code is the live one): move the
  record to the live code by hand, then re-apply the event the same way.

  ```sql
  begin;
  update subscriptions set provider_subscription_code = '<SUB_live>'
   where account_id = '<account uuid>' and provider_subscription_code = '<SUB_dead>';  -- expect UPDATE 1
  insert into subscription_changes (subscription_id, account_id, change_kind, previous_values,
         new_values, change_source, authorised_by, reason)
  select id, account_id, 'subscription_code_set_by_hand',
         jsonb_build_object('provider_subscription_code', '<SUB_dead>'),
         jsonb_build_object('provider_subscription_code', '<SUB_live>'), 'owner', '<your name>',
         'the code on file was already off at Paystack; set the live code after checking the dashboard'
    from subscriptions where account_id = '<account uuid>';
  -- the dead one recorded as replaced and already off, so its own late events are ignored
  insert into billing_superseded (account_id, subscription_code, customer_code, replaced_by_code)
  select account_id, '<SUB_dead>', provider_customer_code, '<SUB_live>'
    from subscriptions where account_id = '<account uuid>';                                   -- expect INSERT 0 1
  select fn_billing_record_switch_off('<SUB_dead>', 'already_off', 'off at Paystack; checked by <your name>, <date>');
  commit;
  ```

### Accounts with two or more subscription codes (PRE row 10)

0067 leaves them alone. In the Paystack dashboard find which subscription is
live. If both are, the one that is not their current plan is the duplicate.
**Record the duplicate as replaced before you switch it off**, so its
`not_renew` and `disable` are ignored instead of held:

```sql
begin;
-- 1. the live code on file (only where none is; skip this step when the right code is already on file)
update subscriptions set provider_subscription_code = '<SUB_live>'
 where account_id = '<account uuid>' and provider_subscription_code is null;   -- expect UPDATE 1
insert into subscription_changes (subscription_id, account_id, change_kind, previous_values,
       new_values, change_source, authorised_by, reason)
select id, account_id, 'subscription_code_set_by_hand', '{"provider_subscription_code":null}',
       jsonb_build_object('provider_subscription_code', '<SUB_live>'), 'owner', '<your name>',
       'set the live Paystack subscription code after checking the dashboard'
  from subscriptions where account_id = '<account uuid>';
-- 2. the duplicate recorded as replaced, with ITS plan (from its Paystack plan code)
insert into billing_superseded (account_id, subscription_code, customer_code, plan_id)
select s.account_id, '<SUB_duplicate>', s.provider_customer_code,
       (select p.id from plans p where p.provider_plan_code = '<PLN_of_the_duplicate>')
  from subscriptions s where s.account_id = '<account uuid>';                  -- expect INSERT 0 1
commit;
```

Then disable the duplicate in the dashboard and record it with
`fn_billing_record_switch_off('<SUB_duplicate>', 'disabled', '…')` (or leave it:
the webhook's next delivery switches it off). Refund any double charge. Until a
code is on file, a paying account's owner is told `switch_needs_support`
("message us") instead of being able to switch.

### Old `no_account` events: reviewed, one at a time, never in bulk

0067 attributes **new** events. Events that failed `no_account` before it stay
failed (PRE row 8), because replaying them could cancel or flip an account, or
move a period backwards. The rules:

1. **Never in bulk.** One event at a time, each in its own transaction, looked
   at before you commit. No `update … where last_error_code = 'no_account'`.
2. **Only the newest event per account.** Older ones for that account are
   history the newest already supersedes; close them as reviewed (step 6),
   never re-apply them.
3. Re-apply only when its effect is the one you expect: a `not_renew` or
   `disable` for an account still `active` that the dashboard shows has
   stopped; a `subscription.create` whose `next_payment_date` is **not earlier**
   than the current period end; a failed payment the dashboard confirms.
4. If it names a subscription code that is not on file, 0067 will hold it again
   (`subscription_not_on_file` / `not_current_subscription`). If the dashboard
   shows that code is the account's live subscription, put it on file first
   (previous section, step 1).

The review list, newest per account marked:

```sql
with q as (
  select e.id, e.event_type, e.received_at,
         fn_billing_find_account(e.payload) as would_match,
         fn_billing_event_sub_code(e.payload) as names_subscription,
         e.payload #>> '{data,next_payment_date}' as next_payment_date
    from billing_events e
   where e.status = 'failed_permanent' and e.last_error_code = 'no_account')
select q.id, q.event_type, q.received_at, q.would_match, q.names_subscription, q.next_payment_date,
       row_number() over (partition by q.would_match->>'account_id' order by q.received_at desc) = 1
         as newest_for_account,
       s.status, s.plan_id, s.current_period_end, s.provider_subscription_code
  from q left join subscriptions s on s.account_id = (q.would_match->>'account_id')::uuid
 order by s.account_id nulls last, q.received_at desc;
```

5. Re-apply the one event:

   ```sql
   begin;
   select status, plan_id, current_period_end, cancel_at_period_end, provider_subscription_code
     from subscriptions where account_id = '<account uuid>';                    -- before
   update billing_events set status = 'processing'
    where id = '<event id>' and status = 'failed_permanent';                    -- expect UPDATE 1
   select fn_billing_apply('<event id>');
   select status, plan_id, current_period_end, cancel_at_period_end, provider_subscription_code
     from subscriptions where account_id = '<account uuid>';                    -- after
   commit;   -- or rollback; if "after" is not what you expected
   ```

6. Close that account's older ones as reviewed, by id:

   ```sql
   update billing_events
      set status = 'ignored',
          last_error = coalesce(last_error, '') || ' -- reviewed <date> <your name>: older than the event re-applied'
    where status = 'failed_permanent' and last_error_code = 'no_account'
      and id in ('<event id>', '<event id>');
   ```

## Rollback

The reverse of the order above:

1. Vercel: set `BILLING_SELF_SERVE` to anything but `on` (or remove it) and
   revert the Vercel deploy. The buttons go and owners read "message us".
2. Supabase secret `BILLING_SELF_SERVE=off`: paystack-checkout then answers
   `switch_needs_support` for every live paid plan change (a trial's first
   payment is unaffected).
3. (`trial-reminder-mailer` belongs to 0066's rollback; leave it unless 0066 is
   being rolled back too.)
4. Redeploy `paystack-checkout` from the commit before this one.
5. `supabase functions delete paystack-manage`.
6. Wait until `billing_superseded` has no row with `disabled_at` null, or switch
   those off in the Paystack dashboard and record them (the sweep above). The
   0067 webhook is still the one switching them off.
7. Redeploy `paystack-webhook` from the commit before this one.
8. `migrations/rollbacks/0067_rollback.sql` with psql `--single-transaction`.
   It **refuses** while a replaced subscription is not recorded as off, and
   lists the codes. Keep `BILLING_SELF_SERVE=off` until the web no longer
   offers a plan change to a paying account.

The rollback restores the three function bodies byte for byte (md5 checked),
drops the table and the five functions, and keeps: recovered and stored
subscription codes, every `subscription_changes` row (append-only), `ignored`
billing events, the events held for review (do not re-apply those after the
rollback: 0051 has none of the checks that held them), and any alert rows of
the new kinds (the kind check is then re-added `NOT VALID`).

## Rehearsal results (18 Oct 2026, repository-built databases on PG 17.6)

Local only (127.0.0.1:55432, databases `mmf2*`, all dropped afterwards). No
Paystack call, no production connection.

| Item | Result |
|---|---|
| `tests/053_billing_self_serve.sql` | **84 / 84 PASS**, on 0001→0064 + 0067 and on 0001→0064 + 0066 + 0067 |
| all suites, 0001→0064 + 0067 (`setup_db -WithProposed`) | 49 suites, **1097 pass, 0 fail**, 2 skipped by design (003, 008) |
| all suites, 0001→0064 + 0066 (db-gate `0066_trial_gate.sql`, md5 `0f3d321e…`, with its suites 018/022/034/052) + 0067 | 50 suites, **1180 pass, 0 fail**, 2 skipped (052: 83, 053: 84) |
| PRE on a production-like 0064 copy (`mm.fresh_install` off; four paying accounts with no code) | 12 / 12 PASS, row 1 "NOT YET"; row 8 `subscription.create 3, subscription.not_renew 1`; row 10 `1 recoverable, 1 with two or more codes` |
| 0067 without 0066, production mode | refused: "fn_require_entitled is missing. Apply 0066_trial_gate first."; nothing changed |
| 0067 without `--single-transaction` | refused by the transaction-control guard; nothing changed |
| 0066 then PRE again | "0066 OK … 118 policies, 102 fn_*"; PRE 12 / 12, row 1 "0066 applied" |
| apply 0067 | "0067 recovery: 1 subscription code(s) recovered; 1 account(s) … left alone for review", "0067 OK … 107 fn_* (+5), 118 policies (unchanged)" |
| POST | 13 / 13 PASS (row 9: 118 policies, 107 fn_*). On a build without 0066 only row 9 fails (104 fn_*), as it should |
| the dead-code-on-file repair above, in a rolled-back transaction | held `not_current_subscription` → code moved, dead one recorded `already_off` → re-applied `applied` (cancelled at period end) → the dead code's late `disable` `ignored` `superseded` |
| rollback with a replaced subscription pending | **refused**, naming the code |
| rollback once recorded off, with a `possible_double_charge` alert row present | "0067 rollback OK: back at 0066; 102 fn_*, 118 policies"; the alert row kept, kind check re-added NOT VALID |
| clean apply then rollback on a 0066 copy | `pg_dump -s` **identical** to the 0066 copy |
| Deno 2.9.6 `deno test`: paystack-webhook / paystack-checkout / paystack-manage / platform-alert-mailer | 23 / 35 / 22 / 8 passed, 0 failed; `deno check index.ts` clean in all four |
