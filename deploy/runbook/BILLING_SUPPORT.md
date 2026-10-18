# Billing support: what to do when a customer writes

For whoever answers Menu Master's support email (today, the owner). Each
section starts with the customer's message and gives the checks, the fix
and a short reply. Answer within **one working day**. The refunds page
promises a reply on refunds within two working days, but aim for one.

Where the work happens:

- **Supabase → SQL Editor**, for the read-only lookups below. The SQL
  Editor shows only the result of the last statement, so paste **one query
  at a time** into a new snippet, replace the `<…>` placeholder, and press
  Run.
- **Paystack Dashboard**, in **Live** mode, for subscriptions, charges and
  refunds. The menu names below may differ slightly from what you see.

Rules that apply to every case:

1. **Check who is writing first (L1).** Only the account's **owner** can
   ask for a refund, a cancellation or a copy of the records. If a staff
   member writes, reply: "Please ask the owner of the business to write to
   us from the email they log in with."
2. **Never edit the `subscriptions` table by hand.** Paystack's notices
   (the webhook) write it. The only sanctioned exceptions are section 9 and
   `DEPLOY_0067.md`'s step that puts a missing subscription code on file
   (used in sections 2 and 10).
3. **Never paste lookup results into WhatsApp, email or a chat.** They hold
   emails, business names and Paystack codes. `BILLING_SUPPORT_CHECKS.sql`
   is the script whose answer is safe to share, because it holds counts only.
4. **Never send costs to anyone but the owner.** Ingredient prices, dish
   costs and profit go to the owner's own email address, nowhere else.
5. **Never cancel a founder's subscription in Paystack by hand.** A founder
   is an account whose L2 shows `founding_price` = true (or a `plan_id`
   starting `founding_`). Cancelling ends the founding price for good once
   Paystack's final `disable` notice arrives, and a forfeited founding place
   never comes back. A founder cancels with **Cancel plan**, which warns
   them first, and pays again with **Pay now** or changes plan in the app.
   If the app cannot do what a founder needs, message the developer. The
   only code you may ever switch off by hand on a founder's account is one
   that **L5 lists as replaced**: its notices change nothing.
6. **In Paystack, find people by code, never by email or by age.** Open the
   customer by the `CUS_` code from L2 (Paystack → Customers → search), and a
   subscription by its `SUB_` code. A staff member may have made the first
   payment, so the Paystack customer's email may not be the owner's. Before
   you cancel any subscription, compare its `SUB_` code with L2's
   `provider_subscription_code`: the one that is **equal** is their current
   plan. If the codes do not match what the section says to expect, stop
   and message the developer.

Start every session with **`BILLING_SUPPORT_CHECKS.sql`** (read only, counts
only). Each section below names the rows that matter.

---

## The two switches: is self-serve billing on?

Self-serve billing for an account that **already pays** (switch plan, Pay
now, Cancel plan, Update your card) has two switches. Both must be on for
the owner to do it themselves.

| Switch | Where it is set | On | Off |
|---|---|---|---|
| **`BILLING_SELF_SERVE`** (web) | Vercel → the project → Settings → Environment Variables, Production | exactly `on` | anything else, or not set (the safe default) |
| **`BILLING_SELF_SERVE`** (edge kill switch) | Supabase → Edge Functions → Secrets | not set, or anything but `off` | exactly `off` |

When the **web** switch is not `on`:

- the Switch to this plan, Pay now, Cancel plan and Update your card buttons
  are hidden for an account that already pays;
- the owner sees: "To change or cancel your plan, message us. We do it for
  you, so you are never charged twice.";
- the web refuses a paying account's checkout (`switch_needs_support`)
  before it reaches Paystack, and Cancel plan / Update your card answer
  `not_configured`;
- the terms, the refunds page and the plans FAQ say "message us" instead of
  naming the buttons.

When the **edge** switch is `off`, `paystack-checkout` itself refuses every
plan change or Pay now on a paying account with `switch_needs_support`,
whatever the web shows. It does not touch Cancel plan or Update your card.

Neither switch ever affects **a trial's first payment**: that always works.

A change to the Vercel variable reaches the site only with the next deploy
(Vercel → Deployments → the latest → ⋯ → Redeploy). A Supabase secret
reaches the function on its next call.

While self-serve is off, or before the release is live
(`DEPLOY_TRIAL_PHASE1.md`), you do these for the owner: **section 10**.

---

## What owners can do themselves (self-serve on)

| They want to | Where | What happens |
|---|---|---|
| Cancel | **More → Account → Cancel plan** (owner of an **active or overdue** plan) | Active: renewal stops at Paystack; the plan stays on until the end of the month already paid for; after that the account is read-only (everything can be opened and read, nothing new can be recorded). Overdue: "Your last payment did not go through. If you cancel now, recording stops straight away and you will not be charged again." Founders are warned that they lose the founding price. No undo: to carry on they choose a plan again. |
| Change plan | **More → Plans & billing → Switch to this plan** on the other plan (owner) | The new plan starts the day they pay. The old Paystack subscription is switched off automatically, so they are never charged for both. **No credit** for the old plan's unused days. Choosing the plan they already pay for is refused (`already_on_plan`). |
| Pay again after a failed payment | **Pay now**, on their own plan in **More → Plans & billing** and on the **Account** page (owner of an overdue plan) | "Your last payment did not go through. Pay now to carry on. The failed plan is switched off, so you are never charged twice." A new paid month starts that day. |
| Put the card right | **Update your card**, beside Pay now (owner of an overdue plan) | Opens Paystack's own page to change the card. Paystack does not retry a failed charge by itself (section 5), so this alone may not collect the missed month: Pay now does. |
| Carry on after cancelling | **Plans & billing → Choose this plan again** (owner, cancelled, still inside the paid month) | "Your plan is on until <date>. Choosing it again starts a new paid month today." The ending subscription simply ends. |
| Get a copy of their records | They message you | You send spreadsheet files within one working day (section 7). |

Your job for these is to **check they worked** when someone asks, and to
step in when they did not.

What the owner may quote back to you:

| They saw | Code | Means | You |
|---|---|---|---|
| "You are already paying for this plan, so nothing has been charged." | `already_on_plan` | they chose the plan they pay for, and it is active | nothing to do |
| "Plan changes are made by the account owner." / "Only the account owner can …" | `owner_only` | a staff member tried, or the login is on two accounts | rule 1, or section 6 |
| "To change plan, message us. We switch it over for you so you are never charged twice." | `switch_needs_support` | we hold no Paystack subscription code for them (checks row 9), or the edge switch is off | section 10 |
| "Your plan change is still finishing. Try again in a minute." | `change_in_progress` | a plan change or Pay now is paid, but the new subscription has not reached us yet | wait; after an hour, section 3 "Still finishing" |
| "This login belongs to more than one business." | `ambiguous_account` | the login is on two accounts | section 6 |
| "We could not find your Paystack subscription." | `no_subscription` | no subscription code on file | section 2 or 10 |
| "Online billing is not switched on yet." / "To change or cancel your plan, message us." | `not_configured` | the web switch is off | section 10 |
| "We could not check your current plan, so nothing has been charged. Reload the page and try again." | `plan_unreadable` | the site could not read their plan for a moment, so it offered nothing rather than guess | ask them to reload; if it keeps happening, message the developer |

---

## 1. Lookups

### L1. Who is writing, and which account is theirs

Paste the email address the message came from.

```sql
-- L1  who is this login, and on which accounts
with u as (select id from auth.users where lower(email) = lower('<EMAIL>'))
select m.account_id, a.name as account_name, m.role,
       (m.created_at at time zone 'Africa/Lagos')::date as member_since,
       a.deleted_at is not null                         as account_deleted,
       (select count(*) from memberships m2 where m2.user_id = m.user_id) as accounts_for_this_login
  from memberships m join accounts a on a.id = m.account_id
 where m.user_id in (select id from u)
 order by m.created_at;
```

- **No rows:** that email has no login. Ask which email they sign in with.
- **role is not `owner`:** see rule 1.
- **More than one row:** section 6. The app shows the **first** row (the
  oldest membership), but this login **cannot pay, cancel or update the
  card for either account** (`ambiguous_account`) until it belongs to one.

Copy the `account_id` of the right row. Every other lookup takes it.

### L2. Their plan as our database sees it

```sql
-- L2  the subscription of one account
with a as (select '<ACCOUNT_ID>'::uuid as id)
select p.name as plan, s.plan_id, s.status,
       to_char(s.current_period_end at time zone 'Africa/Lagos', 'Dy DD Mon YYYY HH24:MI') as paid_or_trial_until_lagos,
       to_char((s.current_period_end + fn_payment_failure_grace()) at time zone 'Africa/Lagos',
               'Dy DD Mon YYYY HH24:MI')                                         as grace_ends_lagos_if_overdue,
       s.cancel_at_period_end                                                    as will_not_renew,
       s.founding_price_active                                                   as founding_price,
       fn_account_is_entitled(s.account_id)                                      as can_record_now,
       s.provider_customer_code, s.provider_subscription_code
  from subscriptions s join plans p on p.id = s.plan_id, a
 where s.account_id = a.id;
```

How to read `status`:

| status | means |
|---|---|
| `trialing` | free trial; `can_record_now` false means the trial has ended |
| `active` | paying and renewing |
| `past_due` | the last renewal failed; full use continues until `grace_ends_lagos_if_overdue` |
| `cancelled` | will not renew; full use until `paid_or_trial_until_lagos`, read-only after |

`provider_subscription_code` (starts `SUB_`) is their **current**
subscription and `provider_customer_code` (starts `CUS_`) is the Paystack
customer: search Paystack with these (rule 6).

### L3. What Paystack told us about them

```sql
-- L3  the last 30 Paystack notices for one account, newest first
with a as (select '<ACCOUNT_ID>'::uuid as id),
     s as (select provider_customer_code as cus from subscriptions, a where account_id = a.id)
select to_char(e.received_at at time zone 'Africa/Lagos', 'Dy DD Mon YYYY HH24:MI') as received_lagos,
       e.event_type, e.status, e.last_error_code,
       coalesce(nullif(e.payload #>> '{data,subscription_code}', ''),
                nullif(e.payload #>> '{data,subscription,subscription_code}', ''),
                nullif(e.payload #>> '{data,plan,subscription_code}', ''))  as subscription_code,
       e.payload #>> '{data,metadata,replaces}'                     as replaces_code,
       e.payload #>> '{data,plan,plan_code}'                        as plan_code,
       round((e.payload #>> '{data,amount}')::numeric / 100, 2)     as amount_naira,
       e.reference, e.id as event_id
  from billing_events e, a
 where e.account_id = a.id
    or e.payload #>> '{data,metadata,account_id}' = a.id::text
    or e.payload #>> '{data,customer,customer_code}' = (select cus from s)
 order by e.received_at desc
 limit 30;
```

`status` per notice: `applied` (it changed their plan as it should),
`ignored` (nothing to do), `failed_permanent` or `failed_transient`
(section 8). Read `last_error_code` on the ignored ones:

| `ignored` with | Means |
|---|---|
| (blank) | an event type we do not act on |
| `superseded` | a notice about a subscription a plan change or Pay now replaced. Fine: it must not change their plan |
| `superseded_charge` | **the replaced subscription took a payment. That is a refund** (section 4) |

`replaces_code` is set on the payment of a plan change or Pay now: it names
the subscription that payment replaces. `amount_naira` is blank when the
notice carries no amount; it is never 0 for a missing amount.

### L4. The history we recorded

```sql
-- L4  recorded changes to one account's subscription, newest first
with a as (select '<ACCOUNT_ID>'::uuid as id)
select c.effective_at at time zone 'Africa/Lagos' as when_lagos, c.change_kind, c.change_source,
       c.previous_values, c.new_values, c.authorised_by, c.reason
  from subscription_changes c, a
 where c.account_id = a.id
 order by c.effective_at desc
 limit 30;
```

After 0067 this includes `subscription_replaced`,
`old_subscription_switched_off`, `cancel_requested` and
`card_link_requested`, so you can see when the owner pressed a button.

### L5. Their replaced subscriptions (after 0067)

Before 0067 this fails with "relation billing_superseded does not exist":
there is then nothing to list.

```sql
-- L5  Paystack subscriptions a newer one replaced on one account, newest first
with a as (select '<ACCOUNT_ID>'::uuid as id)
select b.subscription_code as old_code, b.plan_id as old_plan, b.replaced_by_code,
       to_char(b.recorded_at at time zone 'Africa/Lagos', 'Dy DD Mon YYYY HH24:MI') as replaced_lagos,
       to_char(b.disabled_at at time zone 'Africa/Lagos', 'Dy DD Mon YYYY HH24:MI') as switched_off_lagos,
       b.outcome, b.attempts, b.last_error
  from billing_superseded b, a
 where b.account_id = a.id
 order by b.recorded_at desc;
```

`switched_off_lagos` set (`outcome` `disabled` or `already_off`): that old
subscription is off at Paystack. Blank: it is still waiting to be switched
off (section 3).

---

## 2. "I want to cancel" / "Did my cancellation work?"

Cancelling is self-serve: **More → Account → Cancel plan**, for the owner of
an active or an overdue plan. If someone asks how, reply with the short
answer below. If they say they cancelled, check it worked:

1. **L2**, an active plan that was cancelled: `status` = `cancelled`,
   `will_not_renew` = true, `paid_or_trial_until_lagos` = the end of the
   month they paid for, and `can_record_now` = true until then.
   An overdue plan that was cancelled: `status` = `cancelled` and
   `can_record_now` = false straight away (its paid month was already over).
2. **L3:** a `subscription.not_renew` notice, `applied`, a few minutes after
   they pressed the button. A `subscription.disable` follows (for an active
   plan, at the end of the paid month), also `applied`.
3. **Paystack → Subscriptions →** search the `SUB_` code from L2: it shows
   **Non-renewing** (later **Cancelled**).

If it did not work:

| What you see | What to do |
|---|---|
| They are on a trial, or already cancelled | Nothing to cancel. The trial never charges them. |
| The button said there is no subscription to cancel (`provider_subscription_code` blank in L2) | Put the live code on file, then ask them to press Cancel plan again: in Paystack → Customers → their `CUS_` code → Subscriptions, there must be **exactly one** Active subscription; follow `DEPLOY_0067.md` "Accounts with two or more subscription codes", step 1 only (the live code on file), with that `SUB_` code. Two Active, or none: message the developer. |
| The button said Paystack could not be reached | Ask them to try again in an hour. If it fails again: not a founder, and self-serve still fails → cancel it yourself as in section 10. A founder (rule 5): message the developer. |
| "Your plan change is still finishing" | They changed plan or paid again a moment ago. Wait a few minutes; after an hour, section 3 "Still finishing". |
| Paystack shows Non-renewing but L2 still says `active` (or `past_due`) after an hour | The admin alert `cancel_not_confirmed` says the same (checks row 7). Check L3 and section 8. As a last resort, section 9 with `status` = `cancelled` and the period end Paystack shows. |

**Founders:** the founding price stays until the end of the paid month. Once
Paystack's final `disable` notice for their current subscription is
applied, the founding price is gone for good and a later plan is at the
standard price. If they choose a plan again before that date, they keep it.

**Charged after they cancelled:** that is a refund under the refunds page.
Refund it as in section 4, step 4.

Reply (active plan): "To cancel, open More, then Account, and press Cancel
plan. Your plan stays on until <date>, and you will not be charged again.
After that you can still open and read everything you entered."

Reply (overdue plan): "Open More, then Account, and press Cancel plan. Your
last payment did not go through, so recording stops straight away and you
will not be charged again. You can still open and read everything you
entered."

## 3. "I changed plan. Did it work?"

Changing plan is self-serve: **More → Plans & billing → Switch to this
plan**, owner only once the account pays. **Pay now** after a failed
payment works the same way on the same plan. Check:

1. **L2:** the new plan, `status` = `active`, `paid_or_trial_until_lagos`
   about one month after the payment, and a `provider_subscription_code`
   (the **new** one).
2. **L3:** `charge.success` (with `replaces_code` = the old code) and
   `subscription.create` for the new `SUB_` code, both `applied`. Later
   notices for the **old** code are `ignored` with `superseded`: that is the
   old subscription being switched off, and it must not change their plan.
   An `ignored` **`charge.success`** with **`superseded_charge`** is
   different: the old plan charged them again. **Refund it** (section 4).
3. **L5:** the old code, with `switched_off_lagos` set, usually within a
   minute of the new subscription reaching us.
4. **Paystack → Customers →** their `CUS_` code **→ Subscriptions:** exactly
   **one** Active subscription, and its `SUB_` is L2's
   `provider_subscription_code`. The old one is Non-renewing or Cancelled.

**Still finishing** (the owner sees "Your plan change is still finishing",
or L2's `provider_subscription_code` is still the **old** code an hour after
the payment, with L5 showing that same code not yet switched off): the new
subscription's own `subscription.create` has not reached us. Follow
`DEPLOY_0067.md` "Manual switch-off sweep", step 3 (the row with
`is_current = true`): find that event and re-apply it one at a time. If you
are not sure which event to re-apply, message the developer. Never switch
off the code that is still on file: it is the one they pay with today.

**Two still active after an hour** (checks row 15, admin alert
`subscription_not_switched_off`): the new code is on file in L2, but the old
one did not switch off (`DEPLOY_0067.md` "Manual switch-off sweep" is the
same procedure). In Paystack, open the subscription whose `SUB_` code is the
one **L5 lists** and is **not** L2's `provider_subscription_code`. If it is
Active (or Attention), press **Cancel subscription**, then record it, so
the alert clears:

```sql
select fn_billing_record_switch_off('<old SUB_ code from L5>', 'disabled', 'switched off by hand in the Paystack dashboard, <date>, <your name>');
```

If Paystack already shows it Non-renewing, Cancelled or Complete, record
`'already_off'` instead of `'disabled'`.

Its notices then arrive as `ignored` (`superseded`), and L2 does not
change. This is safe for founders too, because that code is in L5. If the
Active one you would cancel is **not** in L5, or **is** L2's code, stop:
message the developer.

They ask why they paid in full for the new plan: there is no credit for the
unused days of the old plan, and Plans & billing says so before payment.
Monthly charges are not refunded for part of a month (refunds page).

## 4. "I was charged twice"

1. `BILLING_SUPPORT_CHECKS.sql` rows **4** (old plan charged after moving),
   **6** (possible double charges), **7** (open alerts), **14** (two
   subscription codes still live), **15** (old subscription not switched
   off) and **16** (two charges less than 25 days apart).
2. **L3** for the account: the `charge.success` notices with their dates,
   amounts, `SUB_` codes, `replaces_code` and `last_error_code`.
3. Decide which case it is:

| Case | What it looks like | What to do |
|---|---|---|
| **Old plan charged after moving** | an `ignored` `charge.success` with `superseded_charge` (row 4; alert `superseded_subscription_charged`) | **Refund it in full** (step 4). Make sure the old subscription is off (section 3, "Two still active"). Resolve the alert with a note. |
| **Paid twice at once** (two tabs, a double tap) | alert `possible_double_charge` (row 6), or two `applied` charges minutes apart | Refund the one they did not mean (step 4). If both started a subscription, the older one is switched off by itself (L5); check section 3, step 4. Resolve the alert with a note. |
| A plan change | a charge for the new plan on the day they changed (`replaces_code` set), the old plan charged earlier in its month | Not a double charge. Explain: the new plan starts the day they pay, with no credit for the old plan's unused days. Check section 3, step 4. |
| Pay now after a failed payment | one charge on the day they pressed Pay now (`replaces_code` = the failed code); the failed charge was never collected | Not a double charge. If Paystack shows the failed month **was** collected as well, that is the old plan charging after moving: refund it. |
| Chose a plan again after cancelling | a new paid month started inside the old one | Not a double charge: Plans & billing said "Choosing it again starts a new paid month today". No refund for part of a month. |
| Two subscriptions both renewing | two Active subscriptions under their `CUS_` code, each charged (rows 14, 16) | Keep the one whose `SUB_` is L2's `provider_subscription_code`. Switch off the other only by `DEPLOY_0067.md` "Accounts with two or more subscription codes" (rule 5 for founders, rule 6 always), then refund the extra charge (step 4). |
| The same month charged twice on one subscription | two charges a few minutes apart, same code | Refund the second (step 4). |
| Charged after cancelling | a charge after the `not_renew` notice | Refund it (step 4). |

4. **To refund:** Paystack → **Transactions** → search the `reference`
   from L3 → open the charge → **Refund**, the full amount. The refunds page
   promises a full refund for these cases if they write within 14 days of
   the charge, and for "your old plan was charged again after you had moved
   to a new one"; it reaches the card in a few days.
5. Reply with the date and amount refunded, and what they are paying from
   now on.

## 5. "My payment failed"

What the owner sees: the app says the last payment did not go through.
They keep full use for 7 days after the paid month ended
(`fn_payment_failure_grace()`); after that the account is read-only until
they pay. With self-serve on, the owner has three buttons:

- **Pay now** (on their own plan in Plans & billing, and on the Account
  page): pays for a new month today. The failed subscription is switched
  off, so they are never charged twice. **This is the one that collects**,
  and it works after the grace days too.
- **Update your card**: Paystack's own page to change the card. Paystack's
  documentation says it **does not retry a failed subscription charge by
  itself** (`docs/D13_PAYSTACK_RESEARCH.md`, P-3), so a new card may only be
  used at the next renewal date and the account can stay overdue until
  then. If they want to carry on now, Pay now.
- **Cancel plan**: recording stops straight away and they are not charged
  again.

Check:

1. **L2:** `status` = `past_due`; `grace_ends_lagos_if_overdue` is the last
   day of full use.
2. After **Pay now**: L2 `active` on the same plan, `paid_or_trial_until_lagos`
   about a month from that day, and a new `SUB_` code; L3 a `charge.success`
   `applied` with `replaces_code` = the failed code; L5 the failed code
   switched off. Not yet, after an hour: section 3, "Still finishing".
3. **Pay now refused** with "To change plan, message us": no subscription
   code is on file (checks row 9; put the live code on file as in section 2,
   then ask them to try again), or self-serve is off (section 10).

While self-serve is on, never cancel the failed subscription in Paystack
to "make room" for a new payment: Pay now does that safely. The only time
you cancel it by hand is section 10 (self-serve off), and never for a
founder, whose hand cancel loses the founding price (rule 5).

## 6. "One login, two accounts"

A login that belongs to two accounts (for example a manager at one business
who also owns another) sees its **oldest** membership in the app: the first
row of L1. It **cannot pay, cancel or update the card for either account**:
checkout answers "This login belongs to more than one business" and Cancel
plan / Update your card answer "Only the account owner can …". That stays
until the login belongs to one account. Once 0066 is live
(`DEPLOY_0066.md`), a login that already belongs to an account can no
longer start a new business through sign-up; it is told to use a different
email. A staff invitation accepted elsewhere can still make one.
`BILLING_SUPPORT_CHECKS.sql` row 17 counts them.

This section is also the fix when such a login's payment, cancel or card
change is refused.

1. **L1** for their email: which accounts, which roles, which is first.
2. Ask which business they want this login for.
3. Fix it without SQL:
   - If they want to keep the login for the **first** account: they create
     the other business again under a different email (or the other
     account's owner invites a different email).
   - If they want it for the **other** account: the owner of the first
     account removes them on **More → People**. The login then opens
     the other account.
4. Never move or delete memberships with SQL. If neither way works (for
   example they own both), message the developer.

## 7. "Please send me a copy of my records" (EXPORT_ACCOUNT)

There is no download button yet. You send a copy as spreadsheet files,
**within one working day**, to the **owner's** login email only (L1 role
`owner`). The files hold costs and profit, so never send them to a staff
member, even a manager.

1. **L1:** confirm the person is the owner. Copy the `account_id`.
2. Run **E0** to see how many rows each file will have.
3. Run **E1** to **E5** one at a time. After each, use the results panel's
   **Export / Download → CSV**. Name the files
   `<business>-dishes.csv`, `-ingredients.csv`, `-purchases.csv`,
   `-sales.csv`, `-sale-lines.csv`. Check the row count under the results
   matches E0.
4. Email the files to the owner's address. Say what each holds.

A blank cell means the figure is not known (for example a dish with an
unpriced ingredient). It is never written as 0. Drafts and cancelled sales
have no "still to pay". Cancelled sales are listed in the sales file with
their reason but no total, and their dishes are left out of the sale-lines
file. Dates are Lagos dates.

```sql
-- E0  how many rows each file will hold
with a as (select '<ACCOUNT_ID>'::uuid as id)
select (select count(*) from recipes r, a where r.account_id = a.id)                 as dishes,
       (select count(*) from ingredients i, a where i.account_id = a.id)             as ingredients,
       (select count(*) from purchase_lines l, a where l.account_id = a.id)          as purchase_lines,
       (select count(*) from orders o, a where o.account_id = a.id)                  as sales,
       (select count(*) from v_sale_lines l, a where l.account_id = a.id)            as sale_lines_not_cancelled,
       (select count(*) from sales_entries e, a where e.account_id = a.id)           as quick_sales_not_exported;
```

```sql
-- E1  dishes: selling price today and the latest cost of one portion
with a as (select '<ACCOUNT_ID>'::uuid as id)
select b.name as business, r.name as dish, r.category,
       case when r.deleted_at is not null then 'put away' else r.status::text end as state,
       p.price                                             as selling_price_naira,
       case when c.is_complete then round(c.cost_per_portion, 2) end as cost_per_portion_naira,
       case when c.is_complete then 'yes' when c.id is not null then 'no, an ingredient has no price' end as cost_complete,
       (c.computed_at at time zone 'Africa/Lagos')::date   as cost_worked_out_on
  from recipes r
  join a on r.account_id = a.id
  join businesses b on b.id = r.business_id
  left join lateral (select rp.price from recipe_prices rp
                      where rp.recipe_id = r.id and rp.variant_id is null and rp.effective_from <= current_date
                      order by rp.effective_from desc, rp.created_at desc limit 1) p on true
  left join lateral (select cs.id, cs.is_complete, cs.cost_per_portion, cs.computed_at from cost_snapshots cs
                      where cs.recipe_id = r.id and cs.variant_id is null
                      order by cs.computed_at desc, cs.seq desc limit 1) c on true
 order by b.name, r.name;
```

```sql
-- E2  ingredients and packaging: the latest price paid
with a as (select '<ACCOUNT_ID>'::uuid as id)
select i.name as item, i.kind, g.name as category, u.code as base_unit,
       lp.effective_date            as last_price_date,
       lp.amount                    as last_amount_paid_naira,
       lp.qty_base                  as for_quantity_in_base_unit,
       lp.unit_cost                 as cost_per_base_unit_naira,
       sp.name                      as supplier,
       case when i.deleted_at is not null then 'put away' when not i.is_active then 'inactive' else 'in use' end as state
  from ingredients i
  join a on i.account_id = a.id
  left join units u on u.id = i.base_unit_id
  left join ingredient_categories g on g.id = i.category_id
  left join lateral (select ip.* from ingredient_prices ip
                      where ip.ingredient_id = i.id and ip.reversed_at is null
                      order by ip.effective_date desc nulls last, ip.created_at desc limit 1) lp on true
  left join suppliers sp on sp.id = lp.supplier_id
 order by i.name;
```

```sql
-- E3  purchases, one row per item bought
with a as (select '<ACCOUNT_ID>'::uuid as id)
select pu.purchase_date, b.name as business, s.name as supplier, pu.reference,
       case pu.status when 'posted' then 'recorded' when 'reversed' then 'cancelled' else pu.status::text end as state,
       i.name as item, l.qty as quantity, un.code as unit, l.amount as amount_paid_naira, pu.note
  from purchases pu
  join a on pu.account_id = a.id
  join businesses b on b.id = pu.business_id
  left join suppliers s on s.id = pu.supplier_id
  join purchase_lines l on l.purchase_id = pu.id
  left join ingredients i on i.id = l.ingredient_id
  left join units un on un.id = l.unit_id
 order by pu.purchase_date, pu.created_at, i.name;
```

```sql
-- E4  sales, one row per sale: total, paid, still to pay
-- (the totals are worked out once for the whole account, not once per sale)
with a as (select '<ACCOUNT_ID>'::uuid as id),
     t as materialized (select sl.order_id, round(sum(sl.net_revenue), 2) as total
                          from v_sale_lines sl, a
                         where sl.account_id = a.id
                         group by sl.order_id)
select o.order_date as sale_date, o.order_no as sale_number, b.name as business, c.name as customer,
       case when o.voided_at is not null then 'cancelled'
            when o.finalised_at is null then 'draft (not confirmed)'
            else o.status::text end                                  as state,
       t.total                                                       as total_naira,
       o.amount_paid                                                 as paid_naira,
       case when t.total is not null and o.finalised_at is not null and o.voided_at is null
            then round(t.total - o.amount_paid, 2) end                   as still_to_pay_naira,
       o.payment_status, o.void_reason as why_cancelled
  from orders o
  join a on o.account_id = a.id
  join businesses b on b.id = o.business_id
  left join customers c on c.id = o.customer_id
  left join t on t.order_id = o.id
 order by o.order_date, o.order_no;
```

```sql
-- E5  sale lines: what was sold, at what price, what it cost, the profit
with a as (select '<ACCOUNT_ID>'::uuid as id)
select sl.order_date as sale_date, sl.order_no as sale_number, sl.customer_name as customer,
       sl.product_name as dish, sl.format_name as size, sl.description,
       sl.qty as quantity, sl.unit_price as price_each_naira, sl.net_revenue as line_total_naira,
       round(sl.unit_cost_at_sale, 2) as cost_each_naira, sl.cogs as cost_naira, sl.gross_profit as profit_naira,
       case when sl.is_confirmed then 'confirmed' else 'draft' end as state
  from v_sale_lines sl
  join a on sl.account_id = a.id
 order by sl.order_date, sl.order_no;
```

E0 also counts **quick sales** (`sales_entries`, an older way of recording
sales). If that number is not 0, message the developer before sending, so
those can be added.

---

## 8. "A Paystack notice failed" (checks rows 2 and 5)

A failed notice is one Paystack sent that did not change the account it was
about. `BILLING_SUPPORT_CHECKS.sql` row 2 lists them by type and reason;
each one also raises the admin alert `billing_failed_permanent`.

| Reason (`last_error_code`) | Means | What to do |
|---|---|---|
| `no_account` | the notice did not say which account it is for | Before 0067 this was common for `subscription.*` and `invoice.payment_failed` notices, because only the first payment carries our account id. 0067 matches new ones by the Paystack subscription code instead. Old ones are re-applied only as `DEPLOY_0067.md` "Old `no_account` events" says: reviewed one at a time, the newest per account, never in bulk. |
| `not_current_subscription` | a cancel or failed payment for a Paystack subscription that is not the account's current one (after 0067). Nothing on the account changed, on purpose | Follow `DEPLOY_0067.md` "A cancel or failed payment held for review", one event at a time. Most often it is a duplicate or old subscription of that customer (for example one you switched off by hand, section 4): record it as replaced and close the event as reviewed, as written there. If Paystack shows it **is** the subscription they pay with, that page says how to put it on file and re-apply the event; for a founder (rule 5), or whenever you are unsure, message the developer instead. |
| `subscription_not_on_file` | the same, for an account with no subscription code on file | The same procedure: put the live code on file first. |
| `no_subscription_code` | a cancel or failed payment that names no subscription and was matched only by the customer code | The same procedure. Look in Paystack at the customer (`CUS_` from L2) to see which subscription it was. |
| `ambiguous_customer`, `ambiguous_subscription` | a Paystack code that is on two of our accounts; nothing was changed rather than guess | Message the developer with the event's `event_id` (L3). |
| `bad_metadata` | our checkout's account id in the notice is not a valid id | Message the developer with the `event_id`. |
| `unmapped_plan_code` | a Paystack plan code not linked to any of our plans | `MAP_PLAN_CODES.sql`, then message the developer. |
| status `rejected` | the notice's signature did not check out: it was not sent by Paystack, or our webhook secret no longer matches Paystack's | Nothing was changed. One or two: nothing to do. Many, or real payments among them (compare with Paystack → Transactions): message the developer. |
| any reason, status `failed_transient` | a passing error; the webhook asked Paystack to send it again, and Paystack does | Nothing, unless checks row 3 still counts it after an hour: then message the developer. |
| anything else | an error inside our database | Message the developer with the event's `event_id` (from L3). |

`ignored` notices are not failures: see the table under L3. The one to act
on is `superseded_charge` (a refund, section 4).

A notice that changed nothing on our side can leave L2 disagreeing with
Paystack. Paystack's dashboard is the truth about money; our row must
follow it. Fix it by letting a new notice arrive, or, as a last resort,
section 9.

## 9. Last resort: correcting our record by hand

Only when Paystack's dashboard plainly shows a state our row does not match,
the notices cannot put it right, and the customer is affected (locked out
while paying, or still recording after their paid month ended). Never to
give anyone a plan they did not pay for, and never to set a Paystack code
(`DEPLOY_0067.md` has its own step for that).

It runs as one transaction. It refuses to run with a placeholder left in,
uses the billing system's own function (`fn_set_subscription_plan`), and
writes one row to the subscription history (`subscription_changes`) saying
who did it and why, unless the database already recorded the change itself.
It changes plan, status and the paid-through date only; "will not renew"
and the founding price follow Paystack's notices.

The reason is shown to the account's members in their history, so write it
in words a customer may read, with no money and no codes.

```sql
-- M1  correct one account's plan, status and paid-through date, and record why
do $fix$
declare
  p_account text := '<ACCOUNT_ID>';
  v_plan    text := '<PLAN_ID>';            -- costing | trading | founding_costing | founding_trading
  v_status  text := '<STATUS>';             -- active | past_due | cancelled
  p_end     text := '<PERIOD_END>';         -- as Paystack shows it, e.g. 2026-11-18 23:59:59+01
  v_who     text := '<YOUR NAME>';
  v_why     text := '<WHY, in words the customer may read>';
  v_account uuid;
  v_end     timestamptz;
  b subscriptions%rowtype;
  v_logged int;
begin
  if p_account like '<%' or v_plan like '<%' or v_status like '<%' or p_end like '<%'
     or v_who like '<%' or v_why like '<%' then
    raise exception 'Fill in every <...> placeholder first. Nothing was changed.';
  end if;
  if v_status not in ('active', 'past_due', 'cancelled') then
    raise exception 'Status must be active, past_due or cancelled. Nothing was changed.';
  end if;
  v_account := p_account::uuid;
  v_end     := p_end::timestamptz;
  select * into b from subscriptions where account_id = v_account for update;
  if not found then
    raise exception 'No subscription for account %. Nothing was changed.', v_account;
  end if;
  perform fn_set_subscription_plan(v_account, v_plan, v_status, v_end, null);
  select count(*) into v_logged from subscription_changes
   where subscription_id = b.id and created_at = now();
  if v_logged = 0 then
    insert into subscription_changes
      (subscription_id, account_id, change_kind, previous_values, new_values,
       change_source, authorised_by, reason)
    values
      (b.id, v_account, 'manual_correction',
       jsonb_build_object('plan_id', b.plan_id, 'status', b.status, 'current_period_end', b.current_period_end),
       jsonb_build_object('plan_id', v_plan, 'status', v_status, 'current_period_end', v_end),
       'owner', v_who, v_why);
  end if;
end
$fix$;
-- then run L2 and L4 to see the result
```

Afterwards: run L2 (the new state) and L4 (one new row), and tell the
customer what you changed.

## 10. Self-serve is off, or not live yet: doing it for them

The owner of a paying account sees "To change or cancel your plan, message
us. We do it for you, so you are never charged twice." (or got
`switch_needs_support` / `not_configured`). Check the switches first (top
of this file): if they should be on, that is the fix. Otherwise:

| They want to | Not a founder | A founder (rule 5) |
|---|---|---|
| **Cancel** | Paystack → Customers → their `CUS_` code (L2) → Subscriptions → open the one whose `SUB_` is L2's `provider_subscription_code` → **Cancel subscription**. Then check as in section 2. If L2 has no code, or the Active one is not L2's code, stop and message the developer. | Do not cancel by hand. Message the developer, or wait until Cancel plan is back. |
| **Change plan** | Cancel the current subscription as in the row above, so it stops renewing; the plan runs to the end of its paid month. On or after that date (L2 `paid_or_trial_until_lagos`), the plan is no longer paying and they choose the new plan on Plans & billing like a first payment. Nothing is charged twice; tell them the new plan starts when the old one ends. | Do not cancel by hand: message the developer. |
| **Pay again after a failed payment** (same plan) | Cancel the failed subscription as above. Its paid month is already over, so L2 shows `cancelled` and read-only within minutes; they then choose their plan on Plans & billing like a first payment, and a new month starts that day. | Do not cancel by hand: message the developer. |
| **Update the card** | If the subscription's page in Paystack offers to email an update-card link, send it; if not, treat it as "pay again" above. | The same, but never the cancel route: message the developer. |
| **No subscription code on file** (`switch_needs_support` with self-serve on, checks row 9) | Put the live code on file (section 2, "no subscription to cancel"); the buttons then work. | The same. |

A trial's first payment is never blocked by either switch.

---

## Short replies

- **Cancel (active):** "Open More, then Account, and press Cancel plan. Your
  plan stays on until <date> and you will not be charged again. After that
  you can still open and read everything you entered."
- **Cancel (overdue):** "Open More, then Account, and press Cancel plan. Your
  last payment did not go through, so recording stops straight away and you
  will not be charged again."
- **Change plan:** "Open More, then Plans & billing, and choose the plan you
  want. It starts the day you pay and the old one stops, so you are never
  charged for both. The days left on the old plan are not carried over."
- **Failed payment:** "Your last payment did not go through. Open More, then
  Plans & billing, and press Pay now to carry on. The failed plan is
  switched off, so you are never charged twice. You can keep using
  everything until <date>."
- **Choose again after cancelling:** "Your plan is on until <date>. Choosing
  it again on Plans & billing starts a new paid month today."
- **Self-serve off:** "To change or cancel your plan, we do it for you, so
  you are never charged twice. We have <done X>; <what happens next>."
- **Change still finishing:** "Your plan change is still finishing. Try
  again in a minute."
- **Charged twice:** "You were charged twice on <date>. We have refunded
  ₦<amount> to your card; it can take a few days to show."
- **Copy of records:** "Here are your records as spreadsheet files: dishes,
  ingredients, purchases, sales and the dishes on each sale."
- **Staff asking:** "Please ask the owner of the business to write to us
  from the email they log in with."
