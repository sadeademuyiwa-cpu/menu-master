# LIVE CUTOVER — opening real payments

> ## ⛔ Read this before running anything with `-Mode Live`.
> After this sequence, real customers are charged real money. It reuses the
> same automation as the TEST run so the two cannot drift apart — the only
> differences are the keys, the plan codes, and that you have to say so out loud.

## The one hazard that makes ordering non-negotiable

Test-mode and live-mode Paystack plan codes are **different strings**, and there
is only one database.

If the live secret is set while `plans.provider_plan_code` still holds the
**test** codes, live webhooks arrive carrying live codes, `fn_billing_apply`
finds no match, and returns `unmapped_plan_code` / `failed_permanent`. **The
customer is charged and receives nothing** until a human intervenes.

So: **map the live codes BEFORE switching the key. Not after, not at the same
time.**

## Before you start

| | |
|---|---|
| TEST mode fully passed | including one real test-card payment verified in the database |
| Four **live** Paystack plans created | ₦7,500 / ₦15,000 / ₦3,500 / ₦7,500, monthly, NGN |
| Naming | exactly one of the two ₦7,500 plans contains the word **Founding** — the script separates them by name and refuses if it cannot |
| Live secret key | to hand, entered only at prompts |
| Database password | to hand, for one `psql` run |

You do **not** need to copy the plan codes by hand. The script reads them from
the Paystack API. They were transposed twice when they were typed.

---

## Step 1 — map the live plan codes

```powershell
cd C:\Users\d\Downloads\menu-master-work
git checkout claude/0049-artifacts
git pull

pwsh -File scripts/ops/Deploy-Paystack.ps1 -Mode Live -Confirm -VerifyOnly
```

It will:

1. refuse unless you type **`OPEN PAYMENTS`** exactly
2. check the branch, commit and a clean tree
3. check the Supabase link and that both secret **names** exist
4. prompt once for the **live** secret key, read your live plans from the
   Paystack API, and match all four
5. **refuse** if any plan is missing, if the two ₦7,500 plans cannot be told
   apart by name, or if two of ours resolve to one code
6. write `deploy/runbook/MAP_PLAN_CODES_LIVE.generated.sql`

`-VerifyOnly` means it deploys nothing on this pass. Read the generated file
before you run it — four rows, four distinct `PLN_` codes.

## Step 2 — apply the mapping

The script never handles your database password, so this one is yours:

```powershell
psql "<session-pooler connection string>" `
     --single-transaction -v ON_ERROR_STOP=1 `
     -f deploy\runbook\MAP_PLAN_CODES_LIVE.generated.sql
```

Expect `NOTICE: MAPPED OK: four plans, four distinct Paystack codes, trial unmapped.`

It refuses before writing anything if a code repeats or a price disagrees with
`plans.price_kobo`. **Not the SQL Editor** — four rows that must land together
is exactly what its autocommit gets wrong.

## Step 3 — swap the secret to the live key

```powershell
npx supabase secrets set PAYSTACK_SECRET_KEY=<live key>
```

Enter it directly. Never through this chat, never into a file.

## Step 4 — redeploy and verify

```powershell
pwsh -File scripts/ops/Deploy-Paystack.ps1 -Mode Live -Confirm
```

Both functions redeploy with the correct flags and must come back **ACTIVE**.
The eleven-scenario harness is **deliberately skipped in live mode** — it posts
signed payloads, which against a live webhook would write real billing events.

## Step 5 — point Paystack at the live webhook

Paystack Dashboard → toggle to **Live** → Settings → API Keys & Webhooks →
Live Webhook URL:

```
https://mgbrrrjxbufstsjrdoug.supabase.co/functions/v1/paystack-webhook
```

## Step 6 — final verification, before you tell anyone

Run `POST_VERIFY_0050.sql` in the SQL Editor. **12/12**, and row 12 must show
the **live** codes, not the test ones. If it still shows test codes, stop:
step 2 did not take, and every payment from here is a customer charged for
nothing.

Then make **one real payment on a real card**, smallest plan, and verify in the
database rather than on screen:

```sql
select event_type, status, applied_at from billing_events order by created_at desc limit 5;
select plan_id, status, price_kobo, founding_price_active,
       provider_customer_code, provider_subscription_code
  from subscriptions where account_id = '<uuid>';
select seq, claimed_at, forfeited_at from founder_slots where account_id = '<uuid>';
```

Expect `applied`; the subscription active with the right `price_kobo`; and for
a founding plan, `claimed_at` set with `reserved_until` null. Then refund
yourself from the Paystack dashboard — the refund does not un-claim the slot,
which is correct: they were the founder.

## Step 7 — the frontend

`/subscribe` reaches customers only once the tracked branch carries this work.
That is a Vercel production deployment and it is your call, separately.

---

## If it goes wrong

| Symptom | What it means | Do this |
|---|---|---|
| `unmapped_plan_code` in `billing_events` | live codes not mapped, or mapped after the key was switched | run step 2, then replay the event from the Paystack dashboard |
| `failed_permanent`, other | `v_billing_reconciliation` has the detail | read it before touching anything |
| Slot reserved but never claimed | payment came under a standard code, or 0050 is missing | check `plans.provider_plan_code` matches the code in the payload |
| Charged but no entitlement | webhook not reaching us | check the Live webhook URL, then Paystack's delivery log |

**Rolling back 0050 is not available** once any founder slot is confirmed — by
design. After the first founder pays, 0050 is the only thing keeping their slot
and price correct.
