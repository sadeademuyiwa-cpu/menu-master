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
   (the webhook) write it. Section 9 is the one sanctioned exception.
3. **Never paste lookup results into WhatsApp, email or a chat.** They hold
   emails, business names and Paystack codes. `BILLING_SUPPORT_CHECKS.sql`
   is the script whose answer is safe to share, because it holds counts only.
4. **Never send costs to anyone but the owner.** Ingredient prices, dish
   costs and profit go to the owner's own email address, nowhere else.

Start every session with **`BILLING_SUPPORT_CHECKS.sql`** (read only, counts
only). Each section below names the rows that matter.

---

## What owners can now do themselves

Since the self-serve billing release (0067, `paystack-manage`), the owner
does these from the app without writing to you:

| They want to | Where | What happens |
|---|---|---|
| Cancel | **More → Account → Cancel plan** (owner only) | Renewal stops at Paystack. The plan stays on until the end of the month already paid for. After that the account is read-only: everything can be opened and read, nothing new can be recorded. Founders are warned that they lose the founding price. There is no undo: to carry on they choose a plan again. |
| Change plan | **More → Plans & billing → the other plan** (owner only once paying) | The new plan starts the day they pay. The old Paystack subscription is switched off automatically, so they are never charged for both. There is **no credit** for the unused days of the old plan. Choosing the plan they already pay for is refused ("already on this plan"). |
| Put a failed payment right | **Update your card** (shown on an overdue account) | Opens Paystack's own page to change the card. |
| Get a copy of their records | They message you | You send spreadsheet files within one working day (section 7). |

Your job for these is to **check they worked** when someone asks, and to
step in when they did not.

Until 0067, `paystack-manage` and the web release that shows these buttons
are all live (`DEPLOY_0067.md`), the buttons are not there. In that gap,
cancel for the owner in Paystack (section 2, "If it did not work"), and do
not let a paying account start a second subscription.

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
  oldest membership), and that is the account any payment is for.

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

`provider_subscription_code` (starts `SUB_`) and `provider_customer_code`
(starts `CUS_`) are what you search for in Paystack.

### L3. What Paystack told us about them

```sql
-- L3  the last 30 Paystack notices for one account, newest first
with a as (select '<ACCOUNT_ID>'::uuid as id),
     s as (select provider_customer_code as cus from subscriptions, a where account_id = a.id)
select to_char(e.received_at at time zone 'Africa/Lagos', 'Dy DD Mon YYYY HH24:MI') as received_lagos,
       e.event_type, e.status, e.last_error_code,
       coalesce(e.payload #>> '{data,subscription_code}',
                e.payload #>> '{data,plan,subscription_code}')      as subscription_code,
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
`ignored` (nothing to do, including notices about a subscription that a
plan change replaced), `failed_permanent` or `failed_transient` (section 8).
`amount_naira` is blank when the notice carries no amount; it is never 0
for a missing amount.

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

---

## 2. "I want to cancel" / "Did my cancellation work?"

Cancelling is self-serve: **More → Account → Cancel plan**. Only the owner
sees the button. If someone asks how, reply with the short answer below. If
they say they cancelled, check it worked:

1. **L2:** `status` = `cancelled`, `will_not_renew` = true,
   `paid_or_trial_until_lagos` = the end of the month they paid for, and
   `can_record_now` = true until then.
2. **L3:** a `subscription.not_renew` notice, `applied`, a few minutes after
   they pressed the button. At the end of the paid month a
   `subscription.disable` notice follows, also `applied`.
3. **Paystack → Subscriptions →** search their `SUB_` code: it shows
   **Non-renewing** (later **Cancelled**).

If it did not work:

| What you see | What to do |
|---|---|
| They are on a trial, or already cancelled | Nothing to cancel. The trial never charges them. |
| `provider_subscription_code` is blank in L2 (the button said there is no subscription to cancel) | Find them in **Paystack → Customers →** their email **→ Subscriptions**, open the active one, **Cancel subscription**. Paystack then sends `not_renew`; L2 should change within minutes. If L3 shows it `failed_permanent` with `no_account`, see section 8. |
| The button said Paystack could not be reached | Ask them to try again in an hour. If it fails again, cancel it yourself in Paystack as in the row above. |
| Paystack shows Non-renewing but L2 still says `active` after an hour | The notice did not reach us. Check L3 and section 8. As a last resort, section 9 with `status` = `cancelled` and the period end Paystack shows. |

**Founders:** the founding price stays until the end of the paid month. Once
Paystack's final `disable` notice is applied, the founding price is gone for
good and a later plan is at the standard price. There is no undo.

**Charged after they cancelled:** that is a refund under the refunds page.
Refund it as in section 4, step 4.

Reply: "To cancel, open More, then Account, and press Cancel plan. Your plan
stays on until <date>, and you will not be charged again. After that you can
still open and read everything you entered."

## 3. "I changed plan. Did it work?"

Changing plan is self-serve: **More → Plans & billing**, owner only once the
account pays. Check:

1. **L2:** the new plan, `status` = `active`, `paid_or_trial_until_lagos`
   about one month after the payment, and a `provider_subscription_code`
   (the new one).
2. **L3:** `charge.success` and `subscription.create` for the new `SUB_`
   code, both `applied`. Notices that later arrive for the **old** code are
   `ignored`: that is the old subscription being switched off, and it must
   not change their plan.
3. **Paystack → Customers →** their email **→ Subscriptions:** exactly
   **one** Active subscription. The old one is Non-renewing or Cancelled.
   Give it an hour after the payment.

If two are still Active after an hour, switch off the **old** one yourself:
open it in Paystack, **Cancel subscription**. Then check L3: its notices are
`ignored` and L2 does not change. If L2 changed to `cancelled`, the new plan
was not recognised as the replacement; use section 9 to put back `active`
on the new plan and message the developer.

They ask why they paid in full for the new plan: there is no credit for the
unused days of the old plan, and Plans & billing says so before payment.
Monthly charges are not refunded for part of a month (refunds page).

## 4. "I was charged twice"

1. `BILLING_SUPPORT_CHECKS.sql` rows 10 and 11 say whether any account has
   two subscription codes or two charges less than 25 days apart.
2. **L3** for the account: list the `charge.success` notices with their
   dates, amounts and `SUB_` codes.
3. Decide which case it is:

| Case | What it looks like | What to do |
|---|---|---|
| A plan change | a charge for the new plan on the day they changed | Not a double charge. Explain: the new plan starts the day they pay, with no credit for the old plan's unused days. Check section 3, step 3. |
| Two subscriptions both renewing | two Active subscriptions in Paystack for one customer, each charged | Cancel the one they did not mean to keep (section 3, last paragraph), then refund the extra charge (step 4). |
| The same month charged twice on one subscription | two charges a few minutes apart, same code | Refund the second (step 4). |
| Charged after cancelling | a charge after the `not_renew` notice | Refund it (step 4). |

4. **To refund:** Paystack → **Transactions** → open the charge →
   **Refund**, the full amount. The refunds page promises a full refund for
   these cases if they write within 14 days of the charge; it reaches the
   card in a few days.
5. Reply with the date and amount refunded, and what they are paying from
   now on.

## 5. "My payment failed"

What the owner sees: the app says the last payment did not go through, and
offers **Update your card**. They keep full use for 7 days after the paid
month ended (`fn_payment_failure_grace()`). After that the account is
read-only until they pay.

1. **L2:** `status` = `past_due`; `grace_ends_lagos_if_overdue` is the last
   day of full use.
2. Ask the owner to press **Update your card** and enter a card that works.
3. **Paystack → Subscriptions →** their `SUB_` code shows whether the failed
   charge is still unpaid (status **Attention**).

Paystack's documentation says it **does not retry a failed subscription
charge by itself** (`docs/D13_PAYSTACK_RESEARCH.md`, P-3). So a new card may
only be used at the next renewal date, and the missed month can stay unpaid.
Confirm this once in Paystack test mode. If the account is still `past_due`
a day after the card was updated:

- They can **choose the other plan** on Plans & billing. That works by
  itself: the new plan starts the day they pay and the old one stops.
- To stay on the **same** plan: cancel the old subscription in Paystack
  (**Cancel subscription**). When L2 shows `cancelled`, the owner chooses the
  same plan again on Plans & billing and pays. A fresh month starts that day.
  Cancelling can end the grace days at once (the paid month is already
  over), leaving the account read-only until they pay: do it only when they
  are ready to pay straight away.
  **Founders:** a founder keeps the founding price as long as Paystack has
  not yet sent its final `disable` notice for the old subscription. Open
  Plans & billing with them and check it still shows the founding price
  before they pay. If it does not, do not let them pay; message the
  developer.

## 6. "One login, two accounts"

A login that belongs to two accounts (for example a manager at one business
who also owns another) only ever sees, and pays for, its **oldest**
membership: the first row of L1. A login that already belongs to an
account can no longer start a new business through sign-up; it is told to
use a different email. `BILLING_SUPPORT_CHECKS.sql` row 12 counts the logins
that are still on two accounts from before that rule.

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
with a as (select '<ACCOUNT_ID>'::uuid as id)
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
  left join lateral (select round(sum(sl.net_revenue), 2) as total
                       from v_sale_lines sl where sl.order_id = o.id) t on true
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

## 8. "A Paystack notice failed" (checks row 2)

A failed notice is one Paystack sent that did not change the account it was
about. `BILLING_SUPPORT_CHECKS.sql` row 2 lists them by type and reason.

| Reason (`last_error_code`) | Means | What to do |
|---|---|---|
| `no_account` | the notice did not say which account it is for | Before 0067 this was common for `subscription.*` and `invoice.payment_failed` notices, because only the first payment carries our account id. 0067 matches them by the Paystack subscription code instead. Old ones are re-applied only as `DEPLOY_0067.md` describes: reviewed one at a time, newest per account, never in bulk. |
| `unmapped_plan_code` | a Paystack plan code not linked to any of our plans | `MAP_PLAN_CODES.sql`, then message the developer. |
| any reason, status `failed_transient` | a passing error; the webhook asked Paystack to send it again, and Paystack does | Nothing, unless checks row 3 still counts it after an hour: then message the developer. |
| anything else | an error inside our database | Message the developer with the event's `event_id` (from L3). |

A notice that changed nothing on our side can leave L2 disagreeing with
Paystack. Paystack's dashboard is the truth about money; our row must
follow it. Fix it by letting a new notice arrive (for example cancel in
Paystack again), or, as a last resort, section 9.

## 9. Last resort: correcting our record by hand

Only when Paystack's dashboard plainly shows a state our row does not match,
the notices cannot put it right, and the customer is affected (locked out
while paying, or still recording after their paid month ended). Never to
give anyone a plan they did not pay for.

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

---

## Short replies

- **Cancel:** "Open More, then Account, and press Cancel plan. Your plan stays on until
  <date> and you will not be charged again. After that you can still open
  and read everything you entered."
- **Change plan:** "Open More, then Plans & billing, and choose the plan you
  want. It starts the day you pay and the old one stops, so you are never
  charged for both. The days left on the old plan are not carried over."
- **Failed payment:** "Your last payment did not go through. Open More, then
  Account, and press Update your card. You can keep using everything until
  <date>."
- **Charged twice:** "You were charged twice on <date>. We have refunded
  ₦<amount> to your card; it can take a few days to show."
- **Copy of records:** "Here are your records as spreadsheet files: dishes,
  ingredients, purchases, sales and the dishes on each sale."
- **Staff asking:** "Please ask the owner of the business to write to us
  from the email they log in with."
