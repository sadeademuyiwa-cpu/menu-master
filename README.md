# Menu Master NG

Financial operating system for African food businesses.

**Know your cost. Know your price. Know your profit.**

---

## Governing rule

**PERSONAL DATA IS THE SOURCE OF TRUTH.**

Each business's costs are calculated exclusively from that business's own entered data. A missing price, conversion, yield or labour rate stays NULL and the record is marked incomplete. Never substitute zero, an industry average, a benchmark, or an assumed Nigerian market value.

If you are an AI agent working in this repo: read `docs/GATE2_FINAL_DESIGN.md` before proposing any schema change.

---

## Repository layout

```
migrations/          run in numeric order, one at a time
  0001_init.sql
  0002_add_container_unit.sql          MUST run alone (enum value)
  0003_seed_catalog.sql
  0004_integrity_and_security_fixes.sql
  0005_unit_conversion_engine.sql
  0006_purchase_posting.sql
  0007_recipe_cost_engine.sql
  0008_snapshot_and_pricing_engine.sql
  0009_sales_freeze_and_profitability.sql
  0010_onboarding.sql
  0011_grants_and_api_surface.sql
  0012_gate1_authorization_hardening.sql

tests/
  0000_local_supabase_shim.sql         local only, emulates auth.users / auth.uid()
  001_correctness_and_isolation.sql    26 tests
  002_gate1_attack_and_regression.sql  54 tests
  003_real_client_role_escalation.sql  run as a restricted client role

docs/
  menu-master-ng-blueprint.md          approved product blueprint
  MENU_MASTER_NG_AUDIT.md              forensic audit
  GATE1_REPORT.md                      authorization hardening report
  GATE2_FINAL_DESIGN.md                serving formats and variants, design locked
```

---

## Status

| Gate | State |
|---|---|
| MVP schema, Level 1 costing + Level 2 trading | Built |
| Forensic audit | Complete |
| **Gate 1, authorization hardening** | **PASSED.** 4 P0 vulnerabilities closed and re-attacked |
| **Gate 2, serving formats and recipe variants** | **Design locked, NOT implemented** |
| Frontend | Not started, correctly |

**Test results at last run:** 26/26 correctness, 54/54 attack and regression, full rebuild 0001 to 0012 clean.

---

## Running locally

Requires PostgreSQL 16.

```bash
createdb menumaster
psql -d menumaster -f tests/0000_local_supabase_shim.sql
for f in migrations/0*.sql; do
  psql -d menumaster -v ON_ERROR_STOP=1 -f "$f" || break
done
psql -d menumaster -f tests/001_correctness_and_isolation.sql
psql -d menumaster -f tests/002_gate1_attack_and_regression.sql
```

`tests/0000_local_supabase_shim.sql` is **local only**. Do not run it against Supabase, which provides `auth.users` and `auth.uid()` itself.

## Running against Supabase

Run `migrations/` in order through the SQL editor or `supabase db push`. Run 0002 on its own and confirm success before 0003: Postgres refuses to use a new enum value in the transaction that created it.

After the first user signs up, call:

```sql
select fn_create_account_and_business('Your Group','Your Kitchen','soup_seller');
```

This creates the account, owner membership, business, default location, settings, default channel, the 180-item starter catalogue and a trial subscription. **It seeds no prices, no conversions and no purchase yields.** Those are yours to enter.

---

## Known open items

**P1, must fix before production**
1. Historical revenue is mutable: `order_lines.unit_price` and `qty` are editable after a sale. Cost is frozen, revenue is not.
2. Recipe variants not implemented (Gate 2 design is locked and ready).
3. A zero-amount purchase posts as a real ₦0 cost.
4. Write-side role enforcement: 24 tables still use `FOR ALL`, so a kitchen user can delete recipes.
5. Tax is in locked MVP scope and is not implemented.
6. Migrations are not idempotent and have no down-migrations.
7. Recompute fan-out on price posting is synchronous and will time out at scale.

**Verify against real Supabase**
`authenticator` is granted `service_role`, so a raw SQL channel could `SET ROLE service_role`. `fn_is_service_context()` also requires the absence of a user JWT subject, which blocks it, but this has only been proven locally.

---

## Do not commit

The following are superseded or broken and must not be added:

- `menu_master_ng_schema.sql` (discarded single-tenant v0)
- `menu-master-ng-schema-mvp.sql` (pre-repair copy of 0001, contains invalid `unique (account_id, lower(name))` constraints and will not run)
- `menu-master-ng-seed.sql` (pre-split copy of 0003, contains the enum alter that must live in 0002)
