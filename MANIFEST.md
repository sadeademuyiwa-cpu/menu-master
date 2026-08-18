# MENU MASTER NG — ARTIFACT MANIFEST

Provenance classification for every file in this repository.

Status values:
- **RECOVERED ORIGINAL** — byte-for-byte as produced by the original build. Not edited, renamed, renumbered or reformatted.
- **RECONSTRUCTED** — rebuilt in this session because the original could not be recovered. Clearly marked in its own header.
- **GENERATED** — produced by the verification pass in this session.

---

## migrations/ — 12 files, all RECOVERED ORIGINALS

Run in numeric order. `0002` **must run alone in its own transaction** (Postgres refuses to use a newly added enum value in the transaction that created it).

| File | Bytes | Status | Responsibility |
|---|---|---|---|
| `0001_init.sql` | 35,543 | RECOVERED ORIGINAL | MVP core schema: 33 tables, 12 enums, RLS baseline |
| `0002_unit_kind_container.sql` | 926 | RECOVERED ORIGINAL | Adds `container` to `unit_kind`. Must run alone |
| `0003_seed.sql` | 24,699 | RECOVERED ORIGINAL | 45 global units (33 container, all `factor_to_base` NULL), 16 categories, 180 catalogue items, `fn_clone_starter_catalog`, `v_missing_unit_conversions` |
| `0004_integrity_and_security_fixes.sql` | 9,720 | RECOVERED ORIGINAL | Account-scoped `fn_can_see_costs(uuid)`; 14 unique `(id, account_id)` keys; 37 composite FKs; purchase lifecycle columns |
| `0005_unit_conversion_engine.sql` | 5,427 | RECOVERED ORIGINAL | `fn_resolve_qty_to_base`, `fn_can_resolve_unit`, rebuilt `v_missing_unit_conversions` |
| `0006_purchase_posting.sql` | 10,536 | RECOVERED ORIGINAL | Draft → post → immutable; reversal not rewrite; reversed prices excluded from cost |
| `0007_recipe_cost_engine.sql` | 15,757 | RECOVERED ORIGINAL | `recipe_cost_result`, recursive `fn__recipe_cost_core`, cycle prevention, floor columns, completeness gate |
| `0008_snapshot_and_pricing_engine.sql` | 6,759 | RECOVERED ORIGINAL | Recompute propagation; `v_price_check` pricing gate; `v_costing_blockers` |
| `0009_sales_freeze_and_profitability.sql` | 6,176 | RECOVERED ORIGINAL | Cost freeze at sale; `cost_coverage_pct`; profitability views |
| `0010_onboarding.sql` | 6,043 | RECOVERED ORIGINAL | Plans/features seed; `fn_create_account_and_business`; `v_onboarding_status` |
| `0011_grants_and_api_surface.sql` | 4,299 | RECOVERED ORIGINAL | Explicit grants; API surface |
| `0012_gate1_authorization_hardening.sql` | 30,016 | RECOVERED ORIGINAL | Gate 1: four P0 fixes, authorization primitives |

All twelve byte sizes match the independent inventory in `docs/MENU_MASTER_NG_AUDIT.md` exactly.

---

## tests/ — 3 RECOVERED ORIGINALS + 1 RECONSTRUCTED

| File | Status | Notes |
|---|---|---|
| `0000_local_supabase_shim.sql` | **RECONSTRUCTED — LOCAL ONLY** | Original not recovered. Rebuilt from requirements observable in suites 001–003 and `docs/GATE1_REPORT.md` §1. Provides `auth.users`, `auth.uid()`, and the `anon` / `authenticated` / `service_role` / `authenticator` roles. **Never run against Supabase**, which supplies these itself |
| `001_correctness_and_isolation.sql` | RECOVERED ORIGINAL | 26 tests (T01–T23) |
| `002_gate1_attack_and_regression.sql` | RECOVERED ORIGINAL | 54 tests (A/B/C/D/E attack, X bypass, L/R legitimate) |
| `003_real_client_role_escalation.sql` | RECOVERED ORIGINAL | Run as `authenticator`, not superuser |

---

## docs/ — RECOVERED ORIGINALS (modern chain, authoritative)

| File | Status |
|---|---|
| `MENU_MASTER_NG_AUDIT.md` | RECOVERED ORIGINAL — forensic audit, 16-artifact inventory, 39-point traceability matrix |
| `GATE1_REPORT.md` | RECOVERED ORIGINAL — authorization hardening report, Gate 1 PASSED |
| `GATE2A_DESIGN.md` | RECOVERED ORIGINAL — design locked, NOT implemented |
| `GATE2_FINAL_DESIGN.md` | RECOVERED ORIGINAL — design locked, NOT implemented |

### MISSING — not substituted

`docs/menu-master-ng-blueprint.md` — the approved product blueprint referenced by `README.md` and cited by `0001_init.sql` as *"Section 1.6 of the blueprint: PERSONAL DATA IS THE SOURCE OF TRUTH"*. **Not recovered. No substitute has been created.** Its requirements survive in testable form as the 39-point traceability matrix in `docs/MENU_MASTER_NG_AUDIT.md`.

---

## docs/historical/ — RECOVERED ORIGINALS, NON-AUTHORITATIVE

These five predate the modern `0001–0012` chain and describe a **different product generation**. They are preserved for provenance only.

**Where they conflict with the modern chain, the modern chain wins.** None of them may be used as a source for schema decisions.

| File | Status | Classification |
|---|---|---|
| `MenuMasterNGReworkAudit.md` | RECOVERED ORIGINAL | Gen-1. Audit of the live single-page `app_state` app; six-phase feature plan |
| `MenuMasterNGArchitectureCheckpoint.md` | RECOVERED ORIGINAL | Gen-1. Validation of the `app_state` JSON-bundle model; Option B decision |
| `MenuMasterNGRelationalDesign.md` | RECOVERED ORIGINAL | Gen-2. First relational design (`business_id` tenancy) |
| `MenuMasterNGFinalSchemaandMigrationPlan.md` | RECOVERED ORIGINAL | Gen-2. 20-table schema + `app_state` migration plan |
| `MenuMasterNGInventoryEngineDesign.md` | RECOVERED ORIGINAL | Gen-2 extension. FIFO stock-lot ledger — **explicitly excluded from the modern MVP scope** |

### Relationship to the missing blueprint

**None of these five supersedes or substitutes for `docs/menu-master-ng-blueprint.md`**, and none has been renamed toward it. Evidence:

- They model tenancy as `businesses` + `business_users` with roles `owner/manager/staff`. The modern chain uses `accounts` → `businesses` → `locations` with `memberships` and roles `owner/manager/kitchen/sales/accountant`.
- They use `recipe_ingredients`, `menu_items`, `ingredient_price_history`. The modern chain uses `recipe_lines`, `recipe_prices`, `ingredient_prices`.
- None contains the governing rule `0001_init.sql` cites as blueprint Section 1.6.
- `MenuMasterNGFinalSchemaandMigrationPlan.md` and `MenuMasterNGRelationalDesign.md` **partially overlap** the blueprint's subject matter (schema, RLS, costing verification) but describe the superseded generation, so they document a different system rather than the missing one.

---

## Verification package — GENERATED this session

| File | Status |
|---|---|
| `VERIFIED_BASELINE.md` | GENERATED — verification record |
| `MANIFEST.md` | GENERATED — this file |
| `SHA256SUMS` | GENERATED — SHA-256 over all 26 artifacts |
