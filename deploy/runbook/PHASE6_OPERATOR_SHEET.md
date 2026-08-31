# PHASE 6 — OPERATOR EXECUTION SHEET

Written for the business owner, not a database engineer. Every step says where
you are, exactly what to paste, what a good result looks like, what to keep, and
the one condition that stops you.

**Deploy the current tip of branch `claude/menu-master-ng-migrations-3faerm`.**
Vercel will show you the commit it picked up — send me that hash and I will
confirm it is the right one.

Two rules that never change:

- **Never paste a password, key or connection string into our chat.** I never
  need one. Send me console output and query results only.
- **When a STOP condition is met, stop.** Do not try to fix production by hand.
  Send me what you saw.

### An important note about the Supabase SQL Editor

The SQL Editor shows only the **last** table a script produces, and it does not
reliably show `NOTICE` messages. So the checks below are written as **separate
numbered queries you run one at a time**, each returning one table. Do not paste
several at once.

*(The files `PHASE6_PRE_BASELINE.sql` and `PHASE6_POST_VERIFY.sql` in the repo
are the same checks for `psql`. If you are using the SQL Editor, use the queries
in this sheet instead — the files contain `psql`-only commands that the editor
will reject.)*

---

# STEP 0 — Prerequisites and backup

**Where:** Supabase Dashboard, in your web browser.
**Changes production?** The snapshot is a new backup. Nothing else changes.

### 0.1 Confirm you are on the right project

Open the Supabase dashboard and select the project. Confirm on **Settings →
General** that this is the project serving `menumasterng.com`.

**Save and send me:** the Project Reference (the short id like
`mgbrrrjxbufstsjrdoug`). *The reference is not a secret. The keys are — do not
send those.*

> **STOP if** you cannot confirm this is the live project.

### 0.2 Confirm backup protection

Go to **Database → Backups**.

- Note whether **Point in Time Recovery** is enabled, and the **earliest
  restorable time**.
- If PITR is not available on your plan, note the **most recent daily backup**
  date and time.

**Save and send me:** PITR on/off, and the earliest restorable timestamp (or the
latest daily backup timestamp).

> **STOP if** there is no backup covering the last 24 hours and no PITR. Do not
> continue without a way back.

### 0.3 Take a manual snapshot now

On the same **Database → Backups** page, take a backup / snapshot if your plan
offers a manual one. If it does not, note that PITR is your restore path.

**Save and send me:** the snapshot identifier and the time you took it, or
"PITR only".

### 0.4 Establish the quiet window

Nobody uses the app from now until STEP 3 is finished. If someone records a sale
in between, the baseline you are about to take becomes wrong and the whole
verification is invalid.

Tell anyone with a login to stop using it. Expect the whole thing to take about
20–30 minutes; the migration itself takes under a second.

### 0.5 Note the current frontend

Open the **Vercel Dashboard → your project → Deployments**. Note the deployment
currently marked Production (its short id and date), so it can be restored
independently of the database.

**Save and send me:** the current production deployment id.

> **STOP if** any of 0.1–0.4 could not be completed.

---

# STEP 1 — Pre-deployment baseline

**Where:** Supabase Dashboard → **SQL Editor** → New query.
**Changes production?** **NO. Every query here only reads.**

Run these **one at a time**. After each, copy the whole result table (or
screenshot it). You will compare them against STEP 3, so keep them together in
one document.

### Query 1.1 — the figures that must not move

```sql
select coalesce(round(sum(revenue),2),0) as total_revenue,
       coalesce(round(sum(cogs),2),0)    as total_cogs,
       count(*)                          as sale_lines,
       coalesce(round(sum(qty),3),0)     as total_units
  from v_sales_unified;
```

**Looks like:** one row, four numbers. It is fine for these to be `0` if no
sales have been recorded yet.

### Query 1.2 — revenue by month

```sql
select period, round(revenue,2) as revenue, round(coalesce(cogs,0),2) as cogs
  from v_profit_by_period
 order by period;
```

**Looks like:** one row per month. Possibly no rows at all — that is fine.

### Query 1.3 — what shape your orders are in

```sql
select status::text                as status,
       (finalised_at is not null)  as has_confirmation_time,
       (voided_at is not null)     as voided,
       count(*)                    as orders
  from orders
 group by 1,2,3
 order by 1,2,3;
```

**Looks like:** a few rows. Any row with `status = confirmed` and
`has_confirmation_time = f` is what the migration will reconcile.

### Query 1.4 — **the most important one.** The orders that will be reconciled

```sql
select id, order_no, status::text as status, order_date
  from orders
 where status not in ('draft','cancelled')
   and finalised_at is null
   and voided_at is null
 order by created_at;
```

**Looks like:** either "no rows" or a short list.

**Save this exactly.** The **number of rows** is the number the migration must
report, and the **ids** are what you check afterwards. If it says no rows, the
migration should report "no legacy orders need reconciling".

### Query 1.5 — a fingerprint of every frozen cost

```sql
select count(*) filter (where unit_cost_at_sale is not null) as frozen_lines,
       coalesce(sum(qty * unit_cost_at_sale),0)              as frozen_total,
       md5(coalesce(string_agg(id::text||':'||coalesce(unit_cost_at_sale::text,'-'),
                               ',' order by id),'')) as frozen_fingerprint
  from order_lines;
```

**Looks like:** one row. The `frozen_fingerprint` is a long string of letters and
numbers. If one kobo of one historical sale moves, that string changes.

### Query 1.6 — the rest of the baseline

```sql
select (select count(*) from cost_snapshots)                                as cost_snapshots,
       (select coalesce(max(computed_at)::text,'none') from cost_snapshots) as newest_snapshot,
       (select count(*) from pg_policies where schemaname='public')         as rls_policies,
       (select count(*) from auth.users)                                    as login_accounts,
       (select count(*) from orders)                                        as orders,
       (select count(*) from customers)                                     as customers;
```

**Looks like:** one row. **`rls_policies` must read `116`.**

> **STOP if** `rls_policies` is not `116`. The database is not in the state this
> deployment was built and tested against. Send me the number.

**Send me:** all six result tables before you go on.

---

# STEP 2 — The migration

**Where:** Supabase Dashboard → **SQL Editor** → New query.
**Changes production? YES.** This is the only step that changes anything.

### 2.1 Get the file

Open, in GitHub, on branch `claude/menu-master-ng-migrations-3faerm`:

```
deploy/runbook/PHASE6_MIGRATE.sql
```

Click **Raw**, then select all and copy. It is about 2,200 lines. It starts with
`begin;` and ends with `commit;`.

### 2.2 Paste and run it — once

Paste the **entire file** into one SQL Editor query and press **Run** **once**.

> **Do not run it in pieces.** Do not split it up. The whole point of the
> `begin;` at the top and `commit;` at the bottom is that either all six changes
> happen or none of them do. Running it in pieces removes that protection.

It should finish in a few seconds.

### 2.3 What success looks like

The editor reports **Success**. If your editor shows messages, you will see
eight `NOTICE` lines. If it shows none, that is normal for the SQL Editor and
**not** a problem — STEP 3 checks the same things.

The messages, if shown:

```
0043 OK: customer detail added, order lines scoped and derived, 116 policies unchanged.
0044 OK: discounts added, allocation deterministic, 116 policies unchanged.
0045: N order(s) were recognised as sales under the old default …      <-- the count
0045 OK: freeze moved to confirmation, drafts live, 116 policies unchanged.
0046 OK: component provenance recorded, one implementation, 116 policies unchanged.
0047 OK: revenue recognised at confirmation, profit measured only where cost is known.
0048: EXECUTE removed from public and anon on ~70 function(s).
0048 OK: no function is executable by public or anon, 116 policies unchanged.
```

**Save and send me:** whatever the editor showed, including any message panel.

### 2.4 STOP conditions

> **STOP if the editor reports an error.** Nothing changed — the migration undid
> itself. Do not retry. Send me the exact error text.
>
> **STOP if `N` in the `0045` line does not equal the number of rows Query 1.4
> returned.** Someone used the app between STEP 1 and now, so the baseline no
> longer describes the database. Go to ROLLBACK.
>
> **STOP if the `0048` line reports a number very different from about 70.**
> Send me the number.

If your editor showed no messages at all, you cannot check these here — STEP 3
checks them instead. Continue to STEP 3.

---

# STEP 3 — Verification. Before the frontend, always.

**Where:** Supabase Dashboard → **SQL Editor**.
**Changes production?** **NO. Every query here only reads.**

### Query 3.1 — the ten automatic checks

Paste this whole block as one query.

```sql
with c as (
  select 'lifecycle: no order reads as a sale without a confirmation time' as check_name,
         (select count(*) from orders
           where status not in ('draft','cancelled')
             and finalised_at is null and voided_at is null) = 0 as ok,
         (select count(*)::text from orders
           where status not in ('draft','cancelled')
             and finalised_at is null and voided_at is null) as detail
  union all
  select 'lifecycle: no order is finalised while still labelled a draft',
         (select count(*) from orders where finalised_at is not null and status = 'draft') = 0,
         (select count(*)::text from orders where finalised_at is not null and status = 'draft')
  union all
  select 'lifecycle: every reconciled order took its own created_at',
         not exists (select 1 from orders where finalised_at < created_at),
         (select count(*)::text from orders where finalised_at < created_at)||' with a time before creation'
  union all
  select 'tenancy: policy count is still 116',
         (select count(*) from pg_policies where schemaname='public') = 116,
         (select count(*)::text from pg_policies where schemaname='public')
  union all
  select 'tenancy: every tenant view is security_invoker',
         (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relkind='v'
             and c.relname <> 'v_billing_reconciliation'
             and not coalesce('security_invoker=on' = any(c.reloptions), false)) = 0,
         coalesce((select string_agg(c.relname,', ') from pg_class c
                    join pg_namespace n on n.oid=c.relnamespace
                   where n.nspname='public' and c.relkind='v'
                     and c.relname <> 'v_billing_reconciliation'
                     and not coalesce('security_invoker=on' = any(c.reloptions), false)),'none')
  union all
  select 'tenancy: no function is executable by public or anon',
         (select count(*) from pg_proc p
           where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
             and (p.proacl is null or '=X/postgres' = any(p.proacl::text[])
                  or 'anon=X/postgres' = any(p.proacl::text[]))) = 0,
         coalesce((select string_agg(p.proname,', ') from pg_proc p
                    where p.pronamespace='public'::regnamespace and p.proname like 'fn\_%'
                      and (p.proacl is null or '=X/postgres' = any(p.proacl::text[])
                           or 'anon=X/postgres' = any(p.proacl::text[]))),'none')
  union all
  select 'tenancy: the cost freezer refuses an unchecked account',
         (select pg_get_functiondef(oid) ~ 'fn_require_member' from pg_proc
           where proname='fn_frozen_sale_cost' and pronamespace='public'::regnamespace),
         'fn_frozen_sale_cost'
  union all
  select 'schema: all six migrations landed',
         (select count(*) from information_schema.columns
           where table_name='order_lines' and column_name in ('business_id','discount_amount')) = 2
         and (select count(*) from information_schema.columns
               where table_name='cost_snapshots'
                 and column_name in ('portion_qty_at_snapshot','variant_overhead_cost')) = 2
         and (select count(*) from pg_views where schemaname='public'
               and viewname in ('v_sale_lines','v_sales_summary','v_product_performance',
                                'v_orders_attention','v_sale_cost_breakdown')) = 5
         and (select count(*) from pg_proc where proname='fn_confirm_order'
               and pronamespace='public'::regnamespace) = 1,
         'columns, views and functions'
  union all
  select 'schema: an order is now born a draft',
         (select column_default from information_schema.columns
           where table_name='orders' and column_name='status') = '''draft''::order_status',
         coalesce((select column_default from information_schema.columns
                    where table_name='orders' and column_name='status'),'none')
  union all
  select 'data: no snapshot gained provenance it never had',
         not exists (
           select 1 from cost_snapshots cs
            where (cs.portion_qty_at_snapshot is not null or cs.variant_overhead_cost is not null)
              and cs.computed_at < (select min(created_at) from orders)),
         'pre-existing snapshots still read NULL for the 0046 columns'
)
select case when ok then 'PASS' else '*** FAIL ***' end as verdict, check_name, detail
  from c order by ok, check_name;
```

**Looks like:** ten rows, **every one reading `PASS`**.

> **STOP if any row reads `*** FAIL ***`.** Go to ROLLBACK. Send me the table.

### Query 3.2 — the figures, compared to Query 1.1

```sql
select coalesce(round(sum(revenue),2),0) as total_revenue,
       coalesce(round(sum(cogs),2),0)    as total_cogs,
       count(*)                          as sale_lines,
       coalesce(round(sum(qty),3),0)     as total_units
  from v_sales_unified;
```

> **STOP if any of the four numbers differs from Query 1.1**, even by a kobo.
> Go to ROLLBACK.

### Query 3.3 — revenue by month, compared to Query 1.2

```sql
select period, round(revenue,2) as revenue, round(coalesce(cogs,0),2) as cogs
  from v_profit_by_period
 order by period;
```

> **STOP if any month's revenue or cogs differs from Query 1.2**, or if a month
> has appeared or vanished. Go to ROLLBACK.

### Query 3.4 — the frozen-cost fingerprint, compared to Query 1.5

```sql
select count(*) filter (where unit_cost_at_sale is not null) as frozen_lines,
       coalesce(sum(qty * unit_cost_at_sale),0)              as frozen_total,
       md5(coalesce(string_agg(id::text||':'||coalesce(unit_cost_at_sale::text,'-'),
                               ',' order by id),'')) as frozen_fingerprint
  from order_lines;
```

> **STOP if `frozen_fingerprint` is not character-for-character identical to
> Query 1.5.** A historical sale's cost has moved. Go to ROLLBACK.

### Query 3.5 — the legacy reconciliation, checked exactly

**If Query 1.4 returned no rows, skip this** and simply confirm that the first
row of Query 3.1 ("no order reads as a sale without a confirmation time") reads
`PASS`.

**If Query 1.4 returned rows:** copy the `id` values from Query 1.4 into the list
below, each in single quotes, separated by commas.

```sql
with expected(id) as (
  select unnest(array[
    'PASTE-THE-FIRST-ID-FROM-QUERY-1.4-HERE',
    'PASTE-THE-SECOND-ID-HERE'
  ]::uuid[])
)
select o.order_no,
       o.status::text                  as status,
       (o.finalised_at is not null)    as now_confirmed,
       (o.finalised_at = o.created_at) as time_taken_from_its_own_creation,
       (select count(*) from order_lines l
         where l.order_id = o.id and l.unit_cost_at_sale is not null) as frozen_lines
  from expected e join orders o on o.id = e.id
 order by o.order_no;
```

**Looks like:** one row per id you pasted. Every row must show
`now_confirmed = t` and `time_taken_from_its_own_creation = t`.

> **STOP if** you get fewer rows than ids you pasted, or if any row shows `f` in
> either column. Go to ROLLBACK.

### Query 3.6 — the rest, compared to Query 1.6

```sql
select (select count(*) from cost_snapshots)                                as cost_snapshots,
       (select coalesce(max(computed_at)::text,'none') from cost_snapshots) as newest_snapshot,
       (select count(*) from pg_policies where schemaname='public')         as rls_policies,
       (select count(*) from auth.users)                                    as login_accounts,
       (select count(*) from orders)                                        as orders,
       (select count(*) from customers)                                     as customers;
```

> **STOP if** `cost_snapshots` or `newest_snapshot` differs from Query 1.6 — the
> migration must not have created or recalculated any cost. **STOP if**
> `rls_policies` is not `116`. **STOP if** `login_accounts` changed. Go to
> ROLLBACK.

**Send me:** all six result tables. **Do not go to STEP 4 until I confirm, or
until you have satisfied yourself that every comparison matches and every check
reads PASS.**

---

# STEP 4 — Frontend and environment

**Where:** Vercel Dashboard, in your browser.
**Changes production? YES** — but only the website, not the data.

**Only start this once STEP 3 is completely clean.**

### 4.1 Set the environment variables

From the earlier investigation, your Vercel project had **no environment
variables at all**, which is why the live site was showing hard-coded sample
data rather than your real figures.

Go to **Vercel → your project → Settings → Environment Variables** and add two,
for the **Production** environment:

| Name | Where to get the value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → **Project URL** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → **anon / public** key |

> Use the **anon / public** key. **Never** the `service_role` key. The anon key
> is designed to be visible in a browser; the service_role key bypasses every
> security rule in the database.
>
> **Do not send either value to me.** I do not need them.

### 4.2 Deploy the frontend

**Vercel → Deployments → Create Deployment**, from branch
`claude/menu-master-ng-migrations-3faerm`, using its **current tip**.

Wait for it to finish and show **Ready**.

**Save and send me:** the new deployment id, and the build status.

> **STOP if** the build fails. The database is fine and already verified; only
> the website is affected. Send me the build log.

---

# STEP 5 — Production smoke test

**Where:** a web browser, at `menumasterng.com`, logged in as yourself.
**Changes production? YES** — you are creating a real sale. Use an obviously
test-looking customer name so you can recognise it later.

Do these in order. For each, note what you saw.

| # | Do this | It is right if | It is wrong if |
|---|---|---|---|
| 1 | **More → Customers**, add a customer called `TEST — please ignore` | The customer appears in the list | An error appears |
| 2 | **Sales → Record a sale**, choose that customer, press Start sale | A page opens saying it is a draft | — |
| 3 | Add an item: pick one of your costed dishes, quantity 1, any price | The item appears; its cost says **"Not locked in yet"** | It shows **₦0.00** as a cost |
| 4 | Go back to **Sales** | Today's takings do **not** include this draft | The draft is counted as money taken |
| 5 | Reopen the sale, press **Confirm sale** | It says Confirmed and shows what you were paid, what it cost and what you kept | Any figure shows ₦0.00 where a cost is unknown |
| 6 | **More → Reports** | Revenue, gross profit, margin and a coverage percentage all appear | Profit is claimed on something with no known cost |
| 7 | Reopen the sale | There is no way to edit the price or quantity | You can still edit it |
| 8 | Open **"Something is wrong with this sale"**, give the reason `test`, cancel it | It says cancelled, keeps the record and the reason | The sale simply disappears |
| 9 | Press **Start the replacement** | A new draft appears, and it says it replaces the earlier sale | No link back to the original |
| 10 | Go to **Sales** | The cancelled sale is no longer counted in the takings, but is still listed | It is still counted, or has vanished entirely |

**Save and send me:** what happened at each of the ten steps, and a screenshot of
anything that looks wrong.

> **STOP and tell me** if step 3, 5 or 6 shows **₦0.00** where a cost is not
> known, or if step 4 counts a draft as money taken. Those are the two things
> this entire phase exists to prevent. Do not roll back on your own — tell me
> first, because the data is likely fine and the fix would be to the website.

### 5.1 Tidy up

Once we have both reviewed the results, delete the replacement draft (it was
never a sale, so deleting it changes no figure) and leave the cancelled sale
alone — it is your audit trail.

---

# ROLLBACK — when, and exactly how

**Where:** Supabase Dashboard → SQL Editor.
**Changes production? YES.**

### When to roll back

Roll back **only** if STEP 2 said Success **and then** something in STEP 3
failed:

- any check in Query 3.1 read `*** FAIL ***`;
- any figure in 3.2, 3.3, 3.4 or 3.6 differed from the baseline;
- Query 3.5 did not confirm every reconciled order.

**Do not roll back if STEP 2 itself failed.** It already undid itself; nothing
happened. Run STEP 3's Query 3.6 to confirm `rls_policies = 116` and stop there.

**Do not roll back for a frontend problem.** Roll the frontend back instead —
Vercel → Deployments → the previous production deployment → **Promote to
Production**.

### How to roll back

Open each file in GitHub, click **Raw**, copy it, paste it into the SQL Editor,
and run it. **One file at a time, in this order, checking each finishes before
starting the next:**

```
migrations/proposed/0048_rollback.sql
migrations/proposed/0047_rollback.sql
migrations/proposed/0046_rollback.sql
migrations/proposed/0045_rollback.sql
migrations/proposed/0044_rollback.sql
migrations/proposed/0043_rollback.sql
```

Then re-run **Query 1.1** and **Query 1.5** and confirm the figures and the
fingerprint match what you captured in STEP 1.

**Send me:** the output of all six, and the two comparison queries.

### What a rollback does not undo — by design

- **Sales confirmed after the deploy keep their frozen costs.** Those are real
  sales; unfreezing them would destroy real economics.
- **The confirmation times written onto legacy orders stay.** Removing them would
  mean guessing which ones were reconciled and which were always finalised, and
  guessing wrong would unlock a real sale. This is harmless: the old reporting
  does not look at that field, so no figure changes.
- **Discounts and customer notes entered after the deploy are lost** along with
  the columns that hold them.

Rolling back also restores two known defects — drafts counted as revenue, and
profit credited on sales whose cost is unknown. Roll back to get out of trouble,
then let us go forward again promptly.

### If the rollback itself does not restore the figures

Restore from the STEP 0 snapshot, or use PITR to the timestamp you recorded in
0.2. This should be unreachable — the rollback restored every one of 2,242
checked schema details exactly in rehearsal — but the snapshot exists for the
case nobody thought of.

---

## Summary of what to send me

| Step | Send |
|---|---|
| 0 | Project ref, PITR status and earliest restore time, snapshot id, current Vercel deployment id |
| 1 | All six result tables |
| 2 | Whatever the editor displayed, including any messages |
| 3 | All six result tables |
| 4 | New deployment id and build status |
| 5 | What happened at each of the ten steps |

No keys. No passwords. No connection strings.
