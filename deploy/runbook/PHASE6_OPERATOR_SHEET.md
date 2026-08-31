# PHASE 6 — OPERATOR EXECUTION SHEET

For the owner to run. I have no route to production (see the deployment report),
so every step below is yours to execute. Nothing here requires improvisation:
run the file, read the gate, stop or continue.

**Deploying commit `cddbfb2db037696eb596647e0a835bcbbb5a74d1`.**

Do not paste any key, password or connection string into the chat. I never need
one. Send back console output only, with any connection string redacted.

---

## Before you start — one thing about the Supabase SQL editor

**The SQL editor does not reliably display `NOTICE` output.** Gate 4 depends on
the `0045` reconciliation count, which arrives as a NOTICE.

- **If you have `psql`** (locally, or via the Supabase connection string): use
  it. You get every NOTICE and a full transcript, which is what I need back.
- **If you only have the SQL editor:** the gate still works. STEP 1 §D lists the
  exact order ids that will be reconciled, and STEP 3 §F lists what actually was.
  Compare those two lists by id. The NOTICE is the convenient route, not the only
  one.

---

## STEP 0 — prerequisites. Any failure stops the deployment.

1. **Confirm the target.** In the Supabase dashboard, confirm the project ref is
   the production one and that it is the project serving `menumasterng.com`.
   Record the ref (the ref alone is not a secret; the keys are).
2. **Confirm PITR** is enabled and note the earliest restorable timestamp.
3. **Take a manual backup/snapshot now** and note its identifier and time.
4. **Establish the quiet window.** No one uses the app between STEP 1 and the end
   of STEP 3. If a write lands in between, the baseline is invalid and you must
   start again.
5. **Note the current frontend deployment** so it can be pinned or rolled back
   independently.

> If any of 1–5 cannot be satisfied, **stop**. Do not run STEP 1.

---

## STEP 1 — baseline (read only, changes nothing)

Run `deploy/runbook/PHASE6_PRE_BASELINE.sql`.

**Keep the complete output.** Sections A, B, D, E and G are all compared later.
Section D is the list of orders `0045` will reconcile — that list is gate 4.

---

## STEP 2 — the migration, as ONE transaction

Run `deploy/runbook/PHASE6_MIGRATE.sql` **as a single buffer**.

```
psql "<your production connection string>" -v ON_ERROR_STOP=1 -f deploy/runbook/PHASE6_MIGRATE.sql
```

or paste the whole file into the SQL editor and execute **once**.

**Never statement by statement.** Every preflight and self-check in it depends on
being able to abort the whole thing.

**Capture the console output.** Expect eight NOTICEs and `COMMIT`:

```
0043 OK …                    116 policies unchanged
0044 OK …                    116 policies unchanged
0045: N order(s) were recognised as sales under the old default …   ← GATE 4
0045 OK …                    116 policies unchanged
0046 OK …                    116 policies unchanged
0047 OK …
0048: EXECUTE removed from public and anon on ~70 function(s).
0048 OK …                    116 policies unchanged
COMMIT
```

### Gates during STEP 2

| Gate | Condition | Action |
|---|---|---|
| **3** | Any ERROR | **STOP.** It rolled itself back; nothing changed. Send me the error |
| **4** | `0045` count ≠ STEP 1 §D count | **STOP and ROLL BACK.** The database moved under the baseline |
| **5** | `0048` count wildly different from ~70 | **STOP.** Production's function population is not what was rehearsed |
| **6** | No `COMMIT` line | **STOP.** Treat as failed; run STEP 3 to confirm nothing landed |

Do not attempt any repair in production. Send me the output.

---

## STEP 3 — verification (read only). Before the frontend, always.

Run `deploy/runbook/PHASE6_POST_VERIFY.sql`. **Keep the complete output.**

| Compare | STEP 3 | against STEP 1 |
|---|---|---|
| Revenue, cogs, sale lines, units | §A | §A |
| Revenue by month, line for line | §B | §B |
| Frozen-cost count, total and **md5** | §C | §E |
| Snapshot count and newest timestamp | §E | §G |
| The reconciled order ids | §F | §D |

Section D is ten self-evaluating checks. **All ten must read PASS.**

> **Any FAIL, any figure that differs, or any id in §F that is not in STEP 1 §D:
> STOP and ROLL BACK. Do not release the frontend.**

---

## STEP 4 — release the frontend

Only after STEP 3 is completely clean. Deploy commit
`cddbfb2db037696eb596647e0a835bcbbb5a74d1`.

The frontend needs `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` set in Vercel — from the audit trail earlier in
this project, the Vercel project had **no environment variables set at all**.
Set them in the Vercel dashboard. Do not send them to me.

---

## STEP 5 — smoke test the owner journey

In the live app, as a real user, in order:

1. **Customer** — open Customers, add or identify one.
2. **Record a sale** — Sales → Record a sale → add two items, one of a costed
   dish and one of something not fully costed if you have one.
3. **Check it is a draft** — it should say so, show no cost, and **not** appear in
   today's takings.
4. **Confirm it** — the figures should appear, and any uncosted line should read
   "Cost not known", never ₦0.00.
5. **Reporting** — Reports should show revenue, costed revenue, gross profit and
   a coverage percentage, and never claim profit on an uncosted line.
6. **Inspect the sale** — reopen it; the cost should be locked and uneditable.
7. **Cancel it** — "Something is wrong with this sale", give a reason. Confirm it
   leaves the figures, that the record and its reason survive, and that the
   replacement links back to the original.

Then send me everything and I will produce the real deployment report.

---

## ROLLBACK, if any gate fails after COMMIT

`deploy/runbook/PHASE6_ROLLBACK.sql` — the six rollbacks in **reverse** order,
**one at a time**, checking each NOTICE. Then re-run STEP 1 and confirm the
financial totals match what you captured.

If STEP 2 failed, there is nothing to roll back: it rolled itself back.

---

## What to send me

1. STEP 1 complete output.
2. STEP 2 complete console output, including all NOTICEs and the `COMMIT`.
3. STEP 3 complete output.
4. STEP 5 result for each of the seven steps, and any screenshot that looks wrong.
5. Backup identifier, PITR earliest restorable time, project ref.

**Redact any connection string.** No keys, ever.
