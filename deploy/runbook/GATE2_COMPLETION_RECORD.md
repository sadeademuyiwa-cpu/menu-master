# GATE 2 — SERVING FORMATS AND RECIPE VARIANTS

**Status: GATE 2 CLOSED. Migrations `0021`–`0026` complete and verified in production.**


## 1. What was deployed

| Migration | Phase | Production verification |
|---|---|---|
| `0021` | 1 — structural | 47 / 44+4 / 93+12 → **47 / 48 / 105** |
| `0022` | 2 — backfill | no-op: 0 eligible recipes |
| `0023` | 3 — overhead basis (D1) | **49 / 48 / 105** |
| `0024` | 4 — variant costing + cutover gate | **52 / 49 / 105** |
| `0025` | 5 — repoint | **53 / 49 / 105 / 5 / 5 / 23 / t** |
| `0026` | security fix | composite variant FKs: **4 / 0** |

Final production state: **53 `fn_*` · 49 relations · 105 policies · anon on 5
reference tables and 0 functions · 5 protected auth users · 0 tenant rows.**

`chk_complete_requires_resolution` is scoped:
`CHECK (((variant_id IS NULL) OR (NOT is_complete) OR (resolved_qty IS NOT NULL)))`

## 2. Locked decisions, all honoured

D1 overhead per yield unit against an explicit basis, option (a) · D2 labour
stays linear · D3 capacity and sellable quantity mutually exclusive by check
constraint · D4 packaging double-count refused from all three insert paths ·
D5 no variant ingredient overrides, structurally impossible · D6 append-only
format change log · D7 deactivate never delete, with no DELETE policy on
`serving_formats` or `recipe_variants` even for an owner.

Rules 1–5 hold: no hard-coded container sizes, Basis A and B only, incomplete
costing never ₦0, `portion_qty` mapped without inferring a container, Gate 1
authorization inherited.

## 3. Test coverage

| Suite | Result |
|---|---|
| `011` Phase 1 structural | 33 / 33 |
| `012` backfill (phase-scoped) | 10 / 10 |
| `013` overhead basis | 15 / 15 |
| `014` cutover | 13 / 13 |
| `015` repoint | 17 / 17 |
| `016` attack matrix | 16 / 16 |
| Gate 1 regression `001`/`002`/`004`/`005` | **154 / 154** |
| `010` anon reference read | 5 / 5 |

## 4. Three defects found by this discipline, not by reading

1. **`0021` broke the costing engine.** `chk_complete_requires_resolution`,
   added unscoped, made every completely-costed recipe fail to snapshot. Caught
   by the acceptance suites before execution; deferred to `0025` and scoped.
2. **The superseded `0021` build reached production anyway.** The two builds
   differed in exactly one statement, and the verification query I supplied
   counted functions, relations and policies — none of which a CHECK constraint
   changes. It reported success on the broken build. `0025` repaired it. Every
   verification from `0026` onward carries a **definition fingerprint**, not
   only counts.
3. **A cross-tenant reference hole.** `0021` added `variant_id` to four tables
   as a plain single-column FK while 76 other references use the Gate 1
   composite pattern. Attack 8 proved account B could attach account A's
   variant to its own price row. **Closed by `0026`, verified 4 / 0 in
   production.**

Nothing about the first two was found by reading the SQL. All three came from
running it.

## 5. Deliberately not done

`recipes.portion_qty` and `business_settings.expected_monthly_units` are
**retained and deprecated**. Dropping them is a separate later migration and is
out of Gate 2 scope. Multi-basis overhead allocation and per-format labour
remain named future scope. The §10 test matrix scenarios beyond those covered
by `013`–`016` are recorded as remaining work.

## 6. Known limitation, recorded not hidden

Overhead allocated per yield unit **under-allocates to small formats**, because
a 500 ml pack occupies nearly as much fridge space and handling attention as a
2.5 L bowl. Combined with linear labour (D2), small formats look better than
they truly are. The direction of the error is now consistent and explainable,
which the old per-portion method's was not. `GATE2_FINAL_DESIGN.md` §5 records
this in full; the fix belongs with the deferred per-container handling work.
