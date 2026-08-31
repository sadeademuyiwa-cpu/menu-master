# PHASE 6 — DEPLOYMENT READINESS PACK

Prepared after acceptance of audit verdict A. **Nothing deployed. Phase 7 not
started.** No migration or application code was changed while preparing this;
two flaws in my own *verification tooling* were found and fixed, and both are
named in §7.

Accepting Phase 6 is not declaring Menu Master NG finished. This pack covers one
controlled change to one database.

---

## 1. The exact before/after change to migration 0045

Two edits, both in `migrations/proposed/0045_confirmation_freeze.sql`. Commit
`4c638e8`.

### Added — a reconciliation step, at line 106, before any of 0045's own DDL

```sql
do $$
declare v_n int;
begin
  select count(*) into v_n from orders
   where status not in ('draft', 'cancelled')
     and finalised_at is null and voided_at is null;
  if v_n > 0 then
    raise notice '0045: % order(s) were recognised as sales under the old default '
                 'and carry no confirmation time. Recording their creation time as '
                 'their confirmation time so their revenue does not change.', v_n;
  else
    raise notice '0045: no legacy orders need reconciling.';
  end if;
end
$$;

update orders
   set finalised_at = created_at,
       finalised_by = created_by
 where status not in ('draft', 'cancelled')
   and finalised_at is null
   and voided_at is null;
```

### Changed — the self-check widened

```sql
-- before
if exists (select 1 from orders where status = 'confirmed' and finalised_at is null) then
  raise exception '0045 self-check FAILED: an order is confirmed with nothing frozen.';

-- after
if exists (select 1 from orders
            where status not in ('draft', 'cancelled')
              and finalised_at is null and voided_at is null) then
  raise exception '0045 self-check FAILED: % order(s) read as sales with no confirmation time.', …
```

`'confirmed'` alone would have missed `'delivered'`. A third edit added a
paragraph to `0045_rollback.sql` documenting what the rollback deliberately does
not undo (§8).

**Nothing else changed.** No line, no snapshot, no other table, no other
migration.

---

## 2. Why the reconciliation is historically and financially correct

Before this migration, `orders.status` defaulted to `'confirmed'` while
`finalised_at` was set only by `fn_finalise_order`. That produced **two tiers of
"confirmed"**:

- **counted as revenue** — every order whose status was not `cancelled`, because
  `v_sales_unified` keyed on `status`;
- **locked** — only orders that had been through `fn_finalise_order`, because
  every guard keys on `finalised_at`.

Phase 6 merges those into one boundary at `finalised_at`. Orders in the first
tier but not the second have to land somewhere, and there are exactly two
options:

| Option | Consequence |
|---|---|
| Drop them from revenue | The owner's historical figures silently change. In the rehearsal that was **₦6,000 of a ₦36,000 book vanishing** — a 17% drop in reported lifetime revenue, with no event to explain it |
| Record when they were recognised | Historical figures are preserved exactly; the row becomes locked, which it always should have been |

The second is correct because it records what the old system already meant. An
order born `confirmed` *was* recognised as revenue from the moment of creation —
that is what the old default said, and what the old reporting did. Writing
`finalised_at = created_at` records that fact; it does not invent one. Both
values are read off the row.

**Financially:** revenue, cost of sales and every frozen figure are byte-for-byte
unchanged. **No line is touched**, so nothing is re-costed at today's prices —
the failure mode this whole phase exists to prevent.

The rows deliberately left alone:

- **drafts** — excluded from reporting before and after; no decision needed;
- **cancelled** — excluded before and after;
- **voided** — closed records; giving one a confirmation time would be inventing
  a fact about a sale that was undone;
- **anything already carrying a `finalised_at`** — untouched by the `WHERE`.

---

## 3. Idempotency, and that it cannot alter already-valid records

Rehearsed against a database seeded with an order of **every** pre-Phase-6
shape:

| Order | Status before | `finalised_at` before | What happened |
|---|---|---|---|
| FINALISED | confirmed | set | **UNCHANGED** |
| LEGACY | confirmed | NULL | **RECONCILED** from its own `created_at` |
| DRAFT | draft | NULL | **UNCHANGED** |
| VOIDED | confirmed | set, voided | **UNCHANGED** |
| CANCELLED | cancelled | NULL | **UNCHANGED** |

The `NOTICE` reported `1 order(s)` — exactly the one row that qualified.

**Idempotent.** Running the reconciliation statement a second and a third time:

```
UPDATE 0
UPDATE 0
```

The predicate `finalised_at is null` is self-extinguishing: once a row has a
confirmation time it can never match again. It cannot touch an already-valid
record because every already-valid record fails the `WHERE` on its first pass.

**A caveat, stated plainly:** the reconciliation *statement* is idempotent, but
**migration 0045 as a whole is deliberately not re-runnable** — its preflight
refuses if `trg_order_lines_freeze` is already gone. That is intentional: a
migration that silently re-applies is a migration you cannot reason about. Run
it once.

---

## 4. The NOTICE to capture, and what each count means

Eight `NOTICE` lines. **Capture the full console output.** The two that carry
information beyond "it worked":

### `0045` — the reconciliation count

```
NOTICE:  0045: N order(s) were recognised as sales under the old default and
carry no confirmation time. Recording their creation time as their confirmation
time so their revenue does not change.
```
or
```
NOTICE:  0045: no legacy orders need reconciling.
```

| N | Meaning | Action |
|---|---|---|
| **0** | Production never left an order unfinalised. The whole concern is moot | Proceed |
| **matches STEP 1 §D** | Expected. These are orders created before Phase 6 that were never explicitly finalised. Their revenue is preserved | Proceed; confirm the ids in STEP 3 §F |
| **≠ STEP 1 §D** | The database changed between the baseline and the migration — someone was still using the app | **STOP.** Roll back, re-baseline in a quiet window, start again |
| **= the total order count** | `fn_finalise_order` was never called in production at all. Still correct, and revenue is still preserved — but it means every historical order is being given a confirmation time, so check STEP 3 §A especially carefully | Proceed only if STEP 3 §A matches STEP 1 §A exactly |

### `0048` — the grant sweep

```
NOTICE:  0048: EXECUTE removed from public and anon on N function(s).
```

Expect roughly **70**. A wildly different number means production's function
population is not what this pack was rehearsed against — **stop and reconcile
before continuing.**

### The six confirmations

`0043 OK` · `0044 OK` · `0045 OK` · `0046 OK` · `0047 OK` · `0048 OK`, each
reporting *116 policies unchanged*. All six must appear, followed by `COMMIT`.

---

## 5. Pre-deployment backup requirements

Do all four. I have no production access and never ask for credentials — these
are for the owner to perform.

1. **A point-in-time restore window must be active and verified**, covering at
   least the moment before the migration. Confirm in the Supabase dashboard that
   PITR is enabled and note the earliest restorable time.
2. **Take a manual backup / snapshot immediately before STEP 2**, and note its
   identifier. PITR is the safety net; an explicit snapshot is the one you can
   name.
3. **Run STEP 1 and keep the output.** This is not optional and is not a backup
   substitute — it is the only way to *prove* afterwards that nothing moved.
   Sections A, B, D, E and G are all compared later.
4. **Note the current application deployment**, so the frontend can be pinned or
   rolled back independently of the database.

Additional conditions:

- **Deploy in a quiet window.** The migration takes `ACCESS EXCLUSIVE` locks on
  `orders`, `order_lines`, `customers` and `cost_snapshots`. It completed in
  **164 ms** in rehearsal, and production is five users, so the window is
  seconds — but a write arriving mid-migration will block, and a write arriving
  between STEP 1 and STEP 2 invalidates the baseline.
- **Do not deploy the frontend first.** The new pages read views that do not yet
  exist. Database first, verify, then frontend.

---

## 6. Exact production migration order

| Step | What | File | Writes? |
|---|---|---|---|
| 0 | Backups and PITR confirmed | — | no |
| 1 | **Baseline** — capture the figures that must not move | `deploy/runbook/PHASE6_PRE_BASELINE.sql` | **no** |
| 2 | **Migrate** — all six, one transaction | `deploy/runbook/PHASE6_MIGRATE.sql` | yes |
| 3 | **Verify** — ten self-evaluating checks plus baseline comparison | `deploy/runbook/PHASE6_POST_VERIFY.sql` | **no** |
| 4 | Compare STEP 3 §A/§B/§C/§E against STEP 1 §A/§B/§E/§G **by eye** | — | no |
| 5 | Deploy the frontend, only if step 4 is clean | — | — |
| 6 | Smoke test: record a sale, confirm it, check the figures | — | — |

Within STEP 2 the internal order is fixed and each migration refuses to run out
of sequence: **0043 → 0044 → 0045 → 0046 → 0047 → 0048**. `0044` checks 0043
landed, `0046` checks 0045, `0047` checks 0046, `0048` checks 0047.

`PHASE6_MIGRATE.sql` is **generated** by `scripts/build_phase6_deploy.sh` and
carries the SHA-256 prefix of each source in its header, so it cannot silently
drift from the migrations that were tested.

---

## 7. Post-migration verification

`PHASE6_POST_VERIFY.sql`. Ten checks evaluate themselves; four figures are
compared to the baseline by eye because only the operator holds STEP 1's output.

### Financial totals — compared, not asserted

| STEP 3 | must equal | STEP 1 |
|---|---|---|
| §A total revenue, total cogs, sale lines, total units | = | §A |
| §B revenue by month, business by business | = | §B |
| §C frozen-cost count, total and **md5 fingerprint** | = | §E |
| §E snapshot count and newest `computed_at` | = | §G |

The frozen-cost fingerprint is an md5 over every `order_line` id and its frozen
cost. If one kobo of one historical sale moved, it changes.

### Self-evaluating — all ten returned PASS in rehearsal

**Lifecycle** — no order reads as a sale without a confirmation time · no order
is finalised while still labelled a draft · no `finalised_at` predates its own
`created_at`.

**Tenant isolation** — policy count is still 116 · every tenant view is
`security_invoker` (the one documented exception named explicitly) · no `fn_*`
is executable by `public` or `anon` · `fn_frozen_sale_cost` still carries its
membership check.

**Schema** — all six migrations landed · an order is now born a draft.

**Data** — no snapshot predating the data gained the columns 0046 introduced.

### §F — the reconciled orders

Lists the candidate rows for comparison **by id** against STEP 1 §D.

> Two flaws in this tooling, found by running it, fixed, and worth recording
> because the second would have produced a false alarm on the night:
>
> - A check asserted "no snapshot written during the migration" using a one-hour
>   wall clock, so it failed whenever a snapshot happened to be recent. It now
>   asserts the actual invariant.
> - §F counted reconciled orders by `finalised_at = created_at`. That
>   **over-counts**: an order finalised in the same transaction it was created in
>   matches too, and my own fixture produced exactly that — reporting 2 where 1
>   was reconciled. It now lists rows for comparison by id and says why a
>   timestamp test is not enough.
>
> Neither was a product defect. Both were mine.

---

## 8. Recovery if a migration fails midway

**There is no "midway."** STEP 2 is one transaction: it either commits entirely
or leaves the database exactly as it was.

Rehearsed by injecting a deliberate failure partway through `0047` on a database
seeded with legacy data:

```
ERROR:  SIMULATED FAILURE partway through 0047
→ all 2,260 fingerprint lines identical to before the attempt
→ revenue unchanged at ₦36,000.00
→ the 0045 reconciliation did not persist
```

| Situation | Action |
|---|---|
| **STEP 2 fails** | Nothing to undo. Read the error, fix the cause, run STEP 3 to confirm the database is untouched, then retry |
| **STEP 2 commits, STEP 3 shows a FAIL** | Run `PHASE6_ROLLBACK.sql` — the six rollbacks in reverse, one at a time, checking each NOTICE. Then re-run STEP 1 and confirm the financial totals match |
| **Financial totals moved and the rollback does not restore them** | Restore from the STEP 0 snapshot or PITR. This should be unreachable — the rollback restored all 2,242 fingerprint lines exactly in rehearsal — but the snapshot exists for the case I have not thought of |
| **The frontend is broken but the database verified clean** | Roll back the frontend only. The database is forward-compatible: the old pages do not read the new views |

**What a rollback deliberately does not undo**, written into the file:

- lines frozen at confirmation *after* the deploy stay frozen — those are real
  sales;
- the reconciled `finalised_at` values stay — blanking them means guessing which
  rows were reconciled and which were genuinely finalised, and guessing wrong
  unlocks a real sale. Harmless: pre-0045 reporting keys on `status`;
- discounts and customer notes entered after the deploy are lost with their
  columns.

Rolling back `0047` **restores two known defects** — drafts counted as revenue,
and gross profit crediting uncosted revenue as pure profit. Roll back to unblock,
then go forward again quickly.

---

## 9. One transaction, or six?

**One transaction. All six.** That is what `PHASE6_MIGRATE.sql` is.

### Nothing here cannot be wrapped

Checked across all twelve files (forward and rollback) for every statement
PostgreSQL refuses inside a transaction block — `CREATE INDEX CONCURRENTLY`,
`DROP INDEX CONCURRENTLY`, `REINDEX CONCURRENTLY`, `VACUUM`, `CLUSTER`,
`ALTER SYSTEM`, `CREATE`/`DROP DATABASE`, `CREATE TABLESPACE`, `DISCARD ALL`,
and `ALTER TYPE … ADD VALUE`:

```
none found in 0043-0048
```

No forward migration contains its own `begin`/`commit`, so all six wrap cleanly.
Proven, not assumed: the bundle committed in 164 ms and landed **byte-identical**
to the six-step build across 2,445 fingerprint lines.

### Why one transaction is not merely acceptable but required

1. **The preflights and self-checks are only gates if they can abort
   everything.** Each migration asserts the policy count, the previous
   migration's presence, and its own outcome. Under six separate transactions a
   failure in `0045` leaves `0043` and `0044` committed — which is precisely how
   the P1 in the audit would have halted the deployment on a half-migrated
   database.
2. **This is the `0033` lesson.** An assertion that runs after DDL, executed
   statement-by-statement under autocommit, leaves the DDL behind when it
   refuses. `0045` drops a trigger and changes a column default before its
   self-check runs.
3. **The reconciliation and the boundary change must be atomic.** `0045` writes
   `finalised_at` onto legacy orders and then changes what `finalised_at` means
   for reporting. Committing the first without the second, or the reverse, gives
   a window in which the books are wrong.
4. **`0047` drops and recreates four views.** Between the `DROP` and the
   `CREATE`, revenue reporting does not exist. Inside one transaction no reader
   ever observes that gap.

### The one operational cost

One transaction holds `ACCESS EXCLUSIVE` locks for its whole duration. On this
data that is **164 ms**; production is five users. Deploy in a quiet window and
the cost is invisible. On a database large enough for the `0043` backfill to
take minutes this trade-off would need revisiting — it does not here.

### How to run it

Run the file as **one buffer** — `psql -1 -f PHASE6_MIGRATE.sql`, or paste the
whole file into the Supabase SQL editor and execute once. **Do not run it
statement by statement**; that defeats every gate in it.

---

## 10. The two remaining P3 UI findings — deferred polish only

Recorded so they are not lost. Neither is a defect in the financial system;
neither affects mobile; neither blocks deployment.

### P3 · Secondary naira amounts render at 12px on desktop
`Stat`'s caption (`web/src/components/ui.tsx:125`) is `text-xs`, and money
appears in it: *"less ₦7,000.00 in discounts"*, *"35.26% of ₦47,806.45"*. The
headline figures beside them are 20–30px, and the same captions measure **16–18px
at 360px**. Desktop only. The fix is one token, but it touches every screen, so
it belongs in a deliberate design pass rather than a deployment patch.

### P3 · The masthead link is a 24px pointer target on desktop
"Menu Master NG" in the header. The 44px guidance is a *touch* minimum; every
tap target on all seven 360px screens measured at least 44px. Reported for
completeness rather than as a defect.

Also still open, from the audit and unchanged by it: the accessibility half of
**D-4** (no skip-link, no landmark roles) is the one item I would schedule rather
than carry indefinitely. It is not a Phase 6 defect and does not block this
deployment.

---

## RECOMMENDATION

### A — SAFE TO DEPLOY PHASE 6

**Evidence, all re-run on the committed code for this pack:**

| | |
|---|---|
| SQL suite | **517 / 517**, 19 suites |
| Browser journeys | **87 / 87** and **43 / 43** |
| Legacy replay | **11 / 11** — historical revenue ₦36,000.00 and cost ₦20,700.00 identical before and after |
| Chain from pristine 0042 | rollback restores **2,242** fingerprint lines exactly; reapply matches at **2,445** |
| Bundle as one transaction | commits in **164 ms**, byte-identical to the six-step build |
| Simulated mid-chain failure | rolls back all **2,260** lines; data untouched |
| Reconciliation | moves exactly the qualifying row; `UPDATE 0` on repeat; every other order shape unchanged |
| Post-verify | **10 / 10** self-evaluating checks PASS |
| Cross-tenant probes | **26 / 26** refused |

**The conditions, all owner-side:**

1. PITR confirmed and a manual snapshot taken (§5).
2. STEP 1 run and its output kept — the deployment cannot be verified without it.
3. A quiet window; no writes between STEP 1 and STEP 2.
4. STEP 2 run as one buffer, never statement by statement.
5. The `0045` count matched against STEP 1 §D, and STEP 3 §A/§B/§C/§E compared to
   the baseline before the frontend goes out.

If the `0045` count does not match STEP 1 §D, **stop and roll back** — it means
the database moved under the baseline, and the comparison that proves nothing
was lost is no longer valid.

**Deploy the database first, verify, then the frontend.** Phase 7 remains locked.
