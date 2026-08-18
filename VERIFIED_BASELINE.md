# MENU MASTER NG — VERIFIED BASELINE

Status of the recovered `0001–0012` migration chain as preserved in this repository.

**Verdict: VERIFIED BASELINE**, subject to the two stated qualifications in section 6.

---

## 1. What this baseline is

Twelve **recovered original** migrations, byte-for-byte as originally produced, plus the three recovered test suites and the recovered documentation set. Nothing was renamed, renumbered, edited or reformatted.

Byte sizes of all twelve migrations match the independent inventory in `docs/MENU_MASTER_NG_AUDIT.md` exactly — which is the primary evidence that these are the originals and not reconstructions.

One file is **reconstructed, not recovered**: `tests/0000_local_supabase_shim.sql`. It is marked as such in its own header and in `MANIFEST.md`.

---

## 2. Verification performed

Environment: **PostgreSQL 16.13**, local and disposable. No Supabase connection. No production database. No deployment.

### Migration rebuild — two independent runs from an empty database

Each migration applied in its own `psql` invocation with `ON_ERROR_STOP=1`, so `0002`'s enum value commits in its own transaction before `0003` uses it.

```
  ok  0000_local_supabase_shim.sql   (reconstructed)
  ok  0001_init.sql
  ok  0002_unit_kind_container.sql
  ok  0003_seed.sql
  ok  0004_integrity_and_security_fixes.sql
  ok  0005_unit_conversion_engine.sql
  ok  0006_purchase_posting.sql
  ok  0007_recipe_cost_engine.sql
  ok  0008_snapshot_and_pricing_engine.sql
  ok  0009_sales_freeze_and_profitability.sql
  ok  0010_onboarding.sql
  ok  0011_grants_and_api_surface.sql
  ok  0012_gate1_authorization_hardening.sql
ALL MIGRATIONS APPLIED
```

Run 1 and run 2 identical. Zero errors.

### Test results — independently measured, not taken from the report

| Suite | Claimed in GATE1_REPORT | Measured run 1 | Measured run 2 |
|---|---|---|---|
| `001_correctness_and_isolation.sql` | 26/26 | **26 passed, 0 failed** | **26 passed, 0 failed** |
| `002_gate1_attack_and_regression.sql` | 54/54 | **54 passed, 0 failed** | **54 passed, 0 failed** |

**Total: 80/80.**

Suite 002 by phase: ATTACK A 4/4 · ATTACK B 2/2 · ATTACK C 4/4 · ATTACK D 8/8 · ATTACK E 7/7 · BYPASS 14/14 · LEGIT 7/7 · REGRESS 8/8.

### Test 003 — run as a genuine restricted client (`authenticator`, LOGIN NOINHERIT)

| Step | Expected | Observed |
|---|---|---|
| `authenticated` + user JWT | service context false | `f` ✅ |
| `SET ROLE postgres` | must ERROR | `ERROR: permission denied to set role "postgres"` ✅ |
| `SET ROLE service_role` while holding a user JWT | SET succeeds, service context false | SET ok, `f` ✅ |
| genuine `service_role`, no JWT | service context true | `t` ✅ |

### Independent invariant checks (not part of the recovered suites)

| Check | Result |
|---|---|
| `0001`'s own CI contamination query (`ingredient_prices.account_id <> ingredients.account_id`) | **0 rows** ✅ |
| Container units carrying `factor_to_base` | **0** ✅ |
| RLS enabled on schema tables | **33 / 33** ✅ |
| Composite FKs `fk_*_account` / unique keys `ux_*_id_account` | **37 / 14** ✅ (matches audit) |
| Seed volumes: units / container / categories / catalogue items | **45 / 33 / 16 / 180** ✅ (matches audit) |
| Seeded prices, conversions or non-default yields in the seed | **none** ✅ (all present rows originate from test fixtures) |
| `fn_can_see_costs` signature after full chain | **`fn_can_see_costs(p_account_id uuid)`** ✅ — the vulnerable zero-arg version is gone |

---

## 3. Governing rules confirmed in running code

- **Personal data is the source of truth.** Account A's price cannot reach Account B (T01).
- **Missing input is NULL, never zero.** Missing price (T03) and missing conversion (T04) both return NULL.
- **Ingredient-specific conversions.** A rice paint conversion does not apply to beans (T02).
- **Completeness gate.** An incomplete recipe yields no margin (T05) and no recommended price (T06), enforced in `v_price_check` at database level.
- **No false zero floor.** When nothing is priced, the floor is NULL, not ₦0 (T21).
- **Immutable snapshots.** Cannot be UPDATEd (T07) or DELETEd (T08); a price change writes a new row (T09).
- **Sales freeze.** Historical `unit_cost_at_sale` survives later price changes (T10); incomplete costing yields revenue but no COGS (T11); `cost_coverage_pct` reports the trustworthy share (T12).
- **Cross-account isolation.** A role in Account B grants nothing in Account A (T13); cross-account references are constraint violations (T19).
- **No seeded assumptions.** No container unit carries a universal weight (T14).
- **Purchase discipline.** Posting is refused on an unresolved conversion (T15); purchase yield raises usable cost (T16); posted purchases are immutable and corrected by reversal (T20).
- **Recursive costing.** An incomplete sub-recipe makes its parent incomplete (T17); cycles are rejected (T18).

---

## 4. Known discrepancy — recorded, deliberately NOT corrected

**Filename mismatch between `README.md` and the actual migration files.**

| README documents | Actual recovered filename |
|---|---|
| `0002_add_container_unit.sql` | **`0002_unit_kind_container.sql`** |
| `0003_seed_catalog.sql` | **`0003_seed.sql`** |

`docs/MENU_MASTER_NG_AUDIT.md` repeats the README's names.

**Resolution: none applied, by instruction.** The recovered filenames are preserved exactly. `README.md` is preserved exactly. Neither side was edited to agree with the other, because both are forensic originals. Anyone scripting against the README's names must use the real filenames above.

---

## 5. Other observations

**`v_price_check` channel fan-out.** `0001` joined `channels ... and c.is_default` (one row per dish). `0008` rebuilds it joining `... and ch.is_active`, so the view returns **one row per dish per active channel**. Correct for channel-specific margins; invisible in the test suites because fixtures use a single `Direct` channel. Consumers must group by channel or dish lists will duplicate. Not a defect.

**`fn_ingredient_unit_cost` is defined three times** (0001 → 0006 → 0012), each superseding the last. Intentional and correct; the 0001 and 0006 bodies are dead code that still read as authoritative.

---

## 6. Qualifications on this verdict

1. **The local test harness is reconstructed.** `tests/0000_local_supabase_shim.sql` is a rebuild. It is faithful to every requirement observable in the recovered suites, but if the original differed the results above could differ on the original harness. Moot against real Supabase, which supplies `auth` and the API roles itself.

2. **The production Supabase boundary remains UNVERIFIED.** `docs/GATE1_REPORT.md` §7 records a residual risk: `authenticator` is granted `service_role`, so a raw SQL channel could `SET ROLE service_role`. The JWT-subject clause in `fn_is_service_context()` blocks the escalation, and test 003 proves it locally — but Supabase's **production** `authenticator` configuration and default privilege grants have never been tested. **Closing this requires a throwaway Supabase project. It has not been done.**

---

## 7. Explicitly NOT done

- No Supabase deployment. No production database work.
- No Gate 2 implementation (`GATE2A_DESIGN.md` and `GATE2_FINAL_DESIGN.md` remain design-locked, unimplemented).
- No P1 or P2 remediation. The open items in `docs/GATE1_REPORT.md` §8 stand: mutable historical revenue, recipe variants, zero-amount purchases, write-side role enforcement on 24 `FOR ALL` tables, tax unimplemented, non-idempotent migrations with no down-migrations, synchronous recompute fan-out.
- No feature development. No frontend.

---

## 8. Reproducing this verification

Requires PostgreSQL 16. The shim is **local only** — never run it against Supabase.

```bash
createdb menumaster
psql -d menumaster -v ON_ERROR_STOP=1 -f tests/0000_local_supabase_shim.sql
for f in migrations/0*.sql; do
  psql -d menumaster -v ON_ERROR_STOP=1 -f "$f" || break   # 0002 must commit alone
done
psql -d menumaster -f tests/001_correctness_and_isolation.sql
psql -d menumaster -f tests/002_gate1_attack_and_regression.sql
# test 003 must be run as the authenticator role, not as superuser
psql -U authenticator -d menumaster -f tests/003_real_client_role_escalation.sql
```

Artifact integrity: `sha256sum -c SHA256SUMS`
