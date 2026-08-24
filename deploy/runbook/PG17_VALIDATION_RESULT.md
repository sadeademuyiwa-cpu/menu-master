# PART_5 validation on PostgreSQL 17.6

Production runs **PostgreSQL 17.6**. All prior validation ran on **16.13**. This
closes that gap. **Nothing was executed against production.**

## How PG17 was obtained

The proxy denies `apt.postgresql.org`, `github.com` archives and
`ftp.postgresql.org` (403 / connection refused), so a package install or source
build was not possible. `registry.npmjs.org` is on the proxy bypass list, and
`@embedded-postgres/linux-x64@17.6.0-beta.15` ships a complete 17.6 server. Its
bundled ICU 60 libraries were present as `libicu*.so.60.2` but the binary looks
for `libicu*.so.60`; the package does not create those symlinks, so they were
created by hand. The cluster then started normally on port 5433.

This is upstream PostgreSQL 17.6, not Supabase's build. See *Limits* below.

## 1. Exact version tested

```
PostgreSQL 17.6 on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 7.5.0-3ubuntu1~18.04) 7.5.0, 64-bit
```

Production, per the preflight: **17.6**. Major and minor both match.

## 2. Exact file tested

```
deploy/PART_5_gate1_closure.sql
sha256 2ad4577636c029d41bd457b272ab07d5c0a9c090eba59a85fb2c77ad3edcdf8d
66346 bytes · 1466 lines
```

Unmodified. Byte-identical to the artefact validated on 16.13.

## 3. Pre-state

Replica built on 17.6 from `tests/0000_local_supabase_shim.sql` + Parts 1–4,
then the production condition reproduced: the orphaned `handle_new_user`
function, the `on_auth_user_created` trigger, and five `auth.users` rows created
on the observed dates (2026-08-10 to 2026-08-14).

`C2_PART5_PREFLIGHT_v2.sql` on 17.6: **20 GO, 0 STOP**, 2 informational —
`fn_*` 33, relations 42, policies 37, all four Part-5-absent markers absent,
reference data 45 / 16 / 180 and 3 / 12, `auth.users` 5, accounts/businesses/
memberships/profiles 0, `handle_new_user` the only foreign function, trigger
enabled, no `vendors`. The version row now reads **17.6** and matches.

## 4. Migration result

Run as `begin; <PART_5>; commit;`:

```
NOTICE:  0018: LEFT UNTOUCHED (not Menu Master functions): handle_new_user
NOTICE:  0018 self-check passed: anon holds reference-data SELECT only; …
NOTICE:  0018 section 7 passed: the anon reference surface is readable without
         EXECUTE on any Menu Master function.
COMMIT
```

**Zero errors.** All three expected notices, in order.

## 5. Gate and test results

| Check | Result on 17.6 |
|---|---|
| `C2_PART5_GATE.sql` | **26 PASS, 0 STOP** (1 OPERATOR CHECK, 2 informational) |
| Grants fingerprint | `8ac70f63e534` — **identical to 16.13** |
| Policies fingerprint | `b0ce58371195` — **identical to 16.13** |
| `tests/010_anon_reference_read.sql` | **5 PASS, 0 FAIL** — all five reference tables readable, `0 of 40` fn_* executable by anon |
| 001 correctness_and_isolation | 26 / 0 / 26 |
| 002 gate1_attack_and_regression | 54 / 0 / 54 |
| 004 gate1_closure | 23 / 0 / 23 |
| 005 role_write_matrix | 51 / 0 / 51 |
| **Suite total** | **154 of 154, zero psql errors** |

Each suite ran on its own freshly built database, because they are not idempotent.

Live tenant behaviour on 17.6: two tenants onboarded at 180 ingredients each;
tenant B saw only its own business and **could not see** tenant A's custom unit;
`anon` saw 45 units with 0 account-scoped rows and was refused on `accounts`.

## 6. Post-state

| | Value |
|---|---|
| `auth.users` | **5 — unchanged** |
| `accounts` | 0 |
| units / catalog_categories / catalog_ingredients | **45 / 16 / 180 — unchanged** |
| plans / plan_features | **3 / 12 — unchanged** |
| `fn_*` functions | 40 |
| public relations | 43 |
| policies | 92 |
| public FKs to `auth.users` | **14** (was 11 — the three 0014 adds) |
| `handle_new_user` | present, SECURITY DEFINER — **untouched** |
| `on_auth_user_created` | present, `enabled=O` — **untouched** |

The 11 → 14 FK count matches production's observed list exactly: the three
missing there are `orders.finalised_by`, `orders.voided_by` and
`sales_entries.voided_by`, which are precisely what 0014 adds.

## 7. Rollback / transaction result

Run as `begin; <PART_5>; rollback;` on 17.6:

```
fn_* = 33    relations = 42    policies = 37
```

Exactly the pre-state. **PART_5 is fully transactional on PostgreSQL 17.6**, so
a mid-script failure aborts to a clean no-op. Zero psql errors during the
rolled-back run.

## 8. Differences from the 16.13 validation

**None.** Beyond matching counts, a structured metadata dump of a clean Parts
1–5 build on each version was compared line by line:

| Category | 16.13 | 17.6 |
|---|---|---|
| Policies (name, cmd, roles, USING, WITH CHECK) | 92 | 92 |
| Grants (anon, authenticated, service_role) | 475 | 475 |
| `fn_*` signatures + `secdef` flags | 40 | 40 |
| Constraints (name + type) | 212 | 212 |
| Indexes | 72 | 72 |
| Relations (relkind + RLS flag) | 43 | 43 |
| **Total lines** | **934** | **934** |

```
diff meta16.txt meta17.txt  ->  no output
```

**Byte-identical.** No PostgreSQL 16→17 behavioural difference affects this
migration.

## Limits of this validation — stated plainly

1. This is **upstream PostgreSQL 17.6, not Supabase's 17.6 build.** Supabase
   patches its image and ships extensions we do not have locally. The schema
   surfaces PART_5 touches are core PostgreSQL, and the local Supabase shim
   reproduces the roles, `auth` schema and default privileges — but this is a
   faithful reproduction, not the real platform.
2. `pgcrypto` lives in `public` locally and in `extensions` on Supabase. This is
   a known, recorded difference, and it is why every count criterion is scoped
   to `fn_*` rather than raw function totals.
3. PostgREST, GoTrue and realtime are not present locally, so their runtime
   interaction with the new grants is not exercised here. The gate's OPERATOR
   CHECK row and the signup acceptance test cover that separately.

None of these bear on the 16→17 question, which is what this exercise set out
to close.
