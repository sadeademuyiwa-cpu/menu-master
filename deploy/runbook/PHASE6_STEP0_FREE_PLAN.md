# STEP 0 — REVISED FOR THE FREE PLAN

Replaces STEP 0 of `PHASE6_OPERATOR_SHEET.md`. Everything from STEP 1 onward is
unchanged.

The original STEP 0 assumed PITR and scheduled backups. On the Free plan neither
exists, and the database password is unknown. This is the revised gate.

---

## Why the gate can still be met

Phase 6 was examined statement by statement for anything that writes to data
that already exists. Across all six migrations there are five data-modifying
statements, and four of them are **inside function bodies** — they are function
definitions, not things the migration runs:

| Where | Statement | Runs at migration time? |
|---|---|---|
| `0043` line 49 | `update order_lines set business_id = …` | Yes — but it fills a column **added two lines earlier**. It cannot overwrite anything |
| `0045` line 106 | `update orders set finalised_at = created_at, finalised_by = created_by …` | **Yes. This is the only one that writes to a pre-existing column.** |
| `0045` lines 348, 364 | inside `fn_confirm_order` | No |
| `0046` lines 254, 400 | inside the two snapshot writers | No |

So the entire data exposure of Phase 6 is **two columns, on the rows Query 1.4
lists, both of which were NULL before**. That makes the undo exact rather than
approximate:

```sql
update orders set finalised_at = null, finalised_by = null where id in (<the Query 1.4 ids>);
```

**Verified end to end.** On a rehearsal database seeded with legacy orders:
migrate, then roll back the schema, then run the undo — revenue and cost of
sales return to **₦36,000.00 / ₦20,700.00**, the frozen-cost fingerprint returns
to the identical string, and the schema matches across **2,260 checked details**.
The row that was reconciled is `NULL` again; the row that was genuinely finalised
is untouched.

**One thing you must know about that undo:** typed plainly it is *refused* —

```
ERROR:  Order … is finalised. Only payment state may change, or void it.
```

That is the immutability guard working correctly, even against you. The undo has
to suspend triggers deliberately for one statement, which is exactly the friction
it should have. The exact form is in the ROLLBACK section below.

**What this does not cover:** the unforeseen. A backup is insurance against
operator error and the thing nobody thought of, and on Free there is no PITR to
fall back on. That is what the rest of this step is for.

---

## 0.1 — First, look for the password before resetting anything (2 minutes)

**Where:** your own machine and records. **Changes production? No.**

The Supabase database password cannot be displayed again — only reset. But it may
already be written down:

- your password manager, under the Supabase project;
- the notes or email from when the project was created in August;
- a `.env`, `.env.local` or connection string on any machine that has connected;
- if you have ever run `supabase link` for this project, look for a cached
  connection under `supabase/.temp/` in that folder, or `~/.supabase/`.

Your PowerShell check —
`Get-ChildItem Env: | Where-Object { $_.Name -match 'SUPABASE|DATABASE|POSTGRES' }`
— lists variable **names** only, which is the right way to check. If it returned
nothing, this machine has no cached credentials and the CLI would prompt.

> **If you find it:** skip to 0.3. No reset needed.
> **If you do not:** continue to 0.2.

---

## 0.2 — The password reset question, answered honestly

**A real `pg_dump` requires the database password.** `supabase db dump`, `pg_dump`
and the Session Pooler all authenticate with it. There is no Management API or
dashboard route that produces a restorable dump without it. So if you want a true
backup and the password is lost, **it must be reset.** I am not going to dress
that up.

**What Supabase's warning actually means here.** The dashboard warns that
resetting breaks existing connections. What uses the database password?

| Uses the DB password | Does **not** |
|---|---|
| `psql`, `pg_dump`, the Session/Transaction Pooler | Your website — it uses the **anon key** over the REST API |
| Any external tool you connected (BI, Metabase, a backup script) | The Supabase Dashboard and SQL Editor |
| | Supabase's own internal services |

For this project the evidence says **nothing is using it**: the site talks to
PostgREST with the anon key, and the Vercel project currently has **no environment
variables set at all**. So the set of connections a reset would break appears to
be empty.

> **You must confirm one thing I cannot see:** have you connected any *external*
> tool to this database — a reporting tool, a spreadsheet connector, a backup
> script, anything with a `postgresql://` string? If yes, list them; each will
> need the new password. If no, a reset breaks nothing.

**Upgrading to Pro does not solve this and does not fit the timeline.** Pro gives
scheduled backups and PITR going *forward* — you would wait for the first backup
to run before you had a restore point. It is the right long-term answer for a
business holding real financial records, and I would do it soon, but it is not
the fast route to a backup tonight.

---

## 0.3 — Take the backup

**Where:** your terminal. **Changes production? No — a dump only reads.**

If you reset the password, do it **inside the quiet window** (0.5), immediately
before the dump, and store the new one in your password manager. **Never send it
to me.**

```
supabase login
supabase link --project-ref mgbrrrjxbufstsjrdoug
supabase db dump --linked -f phase6-pre-deploy-schema.sql
supabase db dump --linked --data-only -f phase6-pre-deploy-data.sql
```

**Success looks like:** two files, both non-empty. The data file should contain
`COPY public.orders` and `COPY public.order_lines` sections.

**Verify the dump is real before trusting it** — an unverified backup is a guess:

```
Select-String -Path phase6-pre-deploy-data.sql -Pattern "COPY public.orders" -Context 0,3
Select-String -Path phase6-pre-deploy-data.sql -Pattern "COPY public.auth" | Measure-Object
(Get-Item phase6-pre-deploy-*.sql).Length
```

**Save and send me:** the two file sizes and the line count of each. Not the
contents.

> **STOP if** either file is empty, or the data file has no `COPY public.orders`
> section.

---

## 0.4 — If you will not reset the password: the no-password capture

**Where:** Supabase Dashboard → SQL Editor. **Changes production? No.**

This is sufficient for Phase 6's enumerated changes, because of the analysis at
the top of this page. It is **not** a general restore button, and I want you to
know the difference.

Run each and use the SQL Editor's **Download CSV** on the result. Four tables —
these are the only ones Phase 6 touches:

```sql
select * from orders;
select * from order_lines;
select * from customers;
select * from cost_snapshots;
```

Then this, which is the actual undo script for the only mutation — save its
output verbatim:

```sql
select 'update orders set finalised_at = null, finalised_by = null where id in ('
       || string_agg(''''||id||'''', ', ') || ');' as undo_statement
  from orders
 where status not in ('draft','cancelled')
   and finalised_at is null and voided_at is null;
```

**Looks like:** one row containing a complete SQL statement, or no rows if there
is nothing to reconcile.

**Save and send me:** the four CSV row counts and the undo statement.

> **STOP if** any CSV download fails or a row count looks wrong against Query 1.6.

---

## 0.5 — The quiet window, and the rest

Unchanged from the original sheet:

- **Confirm the project.** Settings → General. It is `mgbrrrjxbufstsjrdoug`,
  *MENU MASTER NG*, eu-west-2, PostgreSQL 17.6 — which is the same version every
  rehearsal ran on.
- **Quiet window.** Nobody uses the app from now until STEP 3 finishes. If the
  password is being reset, reset it inside this window.
- **Note the current Vercel production deployment** so the site can be rolled back
  independently.

> **STOP if** the quiet window cannot be held. Everything downstream compares
> against a baseline that a single sale would invalidate.

---

## ROLLBACK — revised, with the reconciliation undo

Replaces the ROLLBACK section's final paragraph.

If STEP 2 committed and STEP 3 then failed:

1. Run the six rollbacks in reverse — `0048` → `0043`, one at a time.
2. **Then** undo the reconciliation. It must suspend triggers for one statement,
   or the immutability guard refuses it. In the SQL Editor:

```sql
begin;
set local session_replication_role = replica;
update orders set finalised_at = null, finalised_by = null
 where id in ('PASTE-THE-QUERY-1.4-IDS-HERE');
commit;
```

**Skip step 2 entirely if Query 1.4 returned no rows.**

3. Re-run Query 1.1 and Query 1.5 and confirm the totals and the frozen-cost
   fingerprint match STEP 1.

> `set local session_replication_role = replica` suspends user triggers for that
> transaction only, and `commit` ends it. Do not use it for anything else, and do
> not leave it set.

If those figures still do not match, restore the `pg_dump` from 0.3 — which is
the reason to have taken it.
