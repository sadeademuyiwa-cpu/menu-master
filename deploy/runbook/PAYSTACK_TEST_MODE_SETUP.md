# PAYSTACK — TEST MODE SETUP AND DEPLOYMENT

**Nothing in this file has been executed. TEST mode only. No live key, no live
plan, no production migration.**

Two edge functions and four Paystack Plans. Do it in this order — each step is
verifiable before the next one can do any harm.

---

## Step 1 — Paystack Plans (TEST mode)

Paystack Dashboard → **make sure the Test/Live toggle says TEST** → Plans →
Create Plan. Four of them, monthly, NGN.

| Plan name | Amount | Interval | Our `plans.id` |
|---|---|---|---|
| Costing | **₦7,500** | Monthly | `costing` |
| Costing + Sales | **₦15,000** | Monthly | `trading` |
| Founding Costing | **₦3,500** | Monthly | `founding_costing` |
| Founding Costing + Sales | **₦7,500** | Monthly | `founding_trading` |

Paystack's form takes **naira**, not kobo — enter `7500`, not `750000`. Our
`price_kobo` is the authority and is already correct; these must agree.

Each saved plan gets a code like `PLN_xxxxxxxxxxxx`. Copy all four.

> **Founding Costing + Sales and Costing are both ₦7,500 and are NOT the same
> plan.** One grants Sales and one does not. Name them exactly as above so they
> cannot be confused in the dashboard six months from now.

### Then map them, in TEST first

Run in the Supabase SQL Editor **of a database you are willing to change** —
for TEST-mode rehearsal this is the only step that writes, and it writes four
strings:

```sql
update plans set provider_plan_code = 'PLN_...' where id = 'costing';
update plans set provider_plan_code = 'PLN_...' where id = 'trading';
update plans set provider_plan_code = 'PLN_...' where id = 'founding_costing';
update plans set provider_plan_code = 'PLN_...' where id = 'founding_trading';

-- verify: four rows, four distinct codes, trial still null
select id, name, price_kobo, provider_plan_code from plans order by id;
```

**Test-mode plan codes are different from live-mode ones.** They must be
replaced at the live gate; this is written down as a blocker, not a footnote.

## Step 2 — Secrets, set directly, never through this chat

```
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_...
supabase secrets set SITE_URL=https://menumasterng.com
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform.

**Vercel needs no new variable.** `/api/checkout` holds no credential — it
proves the caller is signed in and forwards their own token. The Paystack key
exists in exactly one place.

## Step 3 — Deploy both functions

```
supabase functions deploy paystack-webhook  --no-verify-jwt
supabase functions deploy paystack-checkout
```

The flags differ **on purpose**:

- `paystack-webhook` gets `--no-verify-jwt` because Paystack does not send a
  Supabase JWT. Its authentication is the HMAC signature, nothing else.
- `paystack-checkout` gets **no such flag**, so the platform verifies the
  caller's JWT before the function runs. A logged-out request never reaches it.

Getting these backwards would either lock Paystack out of the webhook or open
checkout to anonymous callers.

## Step 4 — Point Paystack at the webhook

Paystack Dashboard → Settings → API Keys & Webhooks → **Test** Webhook URL:

```
https://mgbrrrjxbufstsjrdoug.supabase.co/functions/v1/paystack-webhook
```

## Step 5 — Prove the webhook before anyone can pay

```
export PAYSTACK_SECRET_KEY=sk_test_...      # your shell only, never committed
export WEBHOOK_URL=https://mgbrrrjxbufstsjrdoug.supabase.co/functions/v1/paystack-webhook
export TEST_ACCOUNT_ID=<a uuid from your accounts table>
deno run --allow-env --allow-net deploy/billing/run_eleven_scenarios.ts
```

Seven scenarios run automatically; four are marked MANUAL with their steps.
This posts **locally signed** payloads — no money, no card, no Paystack
involvement at all. It is the cheapest possible proof that verification,
ingest and apply work end to end.

## Step 6 — One real test-card payment

Paystack test card: **4084 0840 8408 4081**, any future expiry, CVV `408`,
OTP `123456`.

Sign in, open `/subscribe`, choose a plan, pay. Then verify **in the database,
not on the screen** — the screen is the one thing that proves nothing:

```sql
select event_type, status, applied_at from billing_events order by created_at desc limit 5;
select plan_id, status, price_kobo, founding_price_active,
       provider_customer_code, provider_subscription_code
  from subscriptions where account_id = '<uuid>';
select seq, claimed_at, reserved_until, forfeited_at
  from founder_slots where account_id = '<uuid>';
```

**Expected:** `billing_events.status = 'applied'`; the subscription active with
`price_kobo = 350000` and `founding_price_active = true`; the slot with
`claimed_at` set and `reserved_until` null.

If `billing_events` has a row but the slot is still merely reserved, 0050 is
not applied to that database. That is precisely the defect 0050 exists to fix.

## Step 7 — STOP

Do not switch to live mode from here. Live keys, live plan codes and the
production 0050 migration are a separate gate with its own report.
