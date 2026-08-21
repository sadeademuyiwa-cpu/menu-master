# Supabase Production Boundary Test — RESULT

**Status: PASSED.** 2026-08-21, against a disposable Supabase project
(`eu-west-1`) provisioned solely for this test and containing no real data.

This closes the single blocker recorded in `docs/GATE1_CLOSURE_REPORT.md` §5 and
`VERIFIED_BASELINE.md` residual 2.

---

## 1. Why this test existed

Every prior result was produced against a local PostgreSQL 16.13 instance using
`tests/0000_local_supabase_shim.sql` — a **reconstructed** stand-in for the
Supabase auth surface. The shim creates its own `anon`, `authenticated`,
`service_role` and `authenticator` roles. Test 003 therefore proved the
escalation defence against *roles we wrote ourselves*, which says nothing about
the ones Supabase actually ships.

This test replaces that assumption with evidence: real GoTrue sign-ins, real
JWTs, real PostgREST, real Supabase-provisioned roles and default privileges.

## 2. Method

Two rival tenants were created by `tests/006_supabase_boundary_fixtures.sql`
through the ordinary onboarding path (`fn_create_account_and_business`):

| | |
|---|---|
| Account A | owns one ingredient price and one private `paint→kg` conversion |
| Account B | owns nothing of A's |
| cashier B | a `sales`-role member of B — the role-escalation probe |

A's price: 1 paint of rice for ₦60,000, with A's own measurement that one paint
is 4,000 g. Unit cost therefore **15 per gram** — a value the engine derives, not
one seeded by us.

All three identities signed in over HTTPS. Probes were issued from a browser
against `/rest/v1/` and `/auth/v1/` exactly as a client application would.

## 3. Result

```
3. Control test — owner A reads her OWN cost, must be 15…
   HTTP 200  body: 15.000000000000000
   control: PASS
4. Running attacks…
   A1  BLOCKED   HTTP 403  42501  Not authorized for this account
   A2  BLOCKED   HTTP 403  42501  Ingredient does not belong to this account
   A3  BLOCKED   HTTP 403  42501  Not authorized for this account
   A4  BLOCKED   HTTP 403  42501  Not authorized for this account
   A5  BLOCKED   HTTP 403  42501  Not authorized for this account
   A6  BLOCKED   HTTP 403  42501  Your role does not permit access to cost information
   X1  BLOCKED   HTTP 200  []
   X2  BLOCKED   HTTP 200  []
   X3  BLOCKED   HTTP 200  []
   X9  BLOCKED   HTTP 200  []
   X12 BLOCKED   HTTP 200  []
   X13 BLOCKED   HTTP 200  []
   X16 BLOCKED   HTTP 403  42501
   X14 service_context=false  HTTP 200
   X15 service_context=false  HTTP 200
```

**Control PASS, 15/15 probes blocked, 0 inconclusive.**

| # | Attempt | Outcome |
|---|---|---|
| CTRL | Owner A reads her own cost | **15** — the test reached live data |
| A1 | Owner B reads A's cost with A's ids | refused `42501` |
| A2 | Owner B mixes A's ingredient with his own business | refused — ownership cross-check |
| A3 | Owner B tries the usable-cost variant | refused |
| A4 | Owner B resolves A's private paint→kg conversion | refused |
| A5 | Cashier B reads A's cost | refused |
| A6 | Cashier B reads her **own** account's cost | refused — role gate, not tenancy |
| X1, X2, X3, X9, X12 | Direct table reads of A's prices, snapshots, conversions, ingredients | 0 rows |
| X13 | Signed-out visitor lists ingredients | 0 rows |
| X16 | Owner B **writes** a price row into A's account | refused `42501` |
| X14, X15 | B's and cashier's sessions ask `fn_is_service_context()` | `false` |

A6 matters independently: it separates the two gates. Cashier B is a legitimate
member of her own account and is still refused cost data, so the block is the
role boundary, not merely the tenant boundary.

X14/X15 close the residual from `GATE1_REPORT.md` §7 on real infrastructure. A
genuine Supabase-issued end-user JWT cannot make `fn_is_service_context()`
return true, because the function requires the absence of
`request.jwt.claim.sub` — which PostgREST always sets for a signed-in user.

## 4. What this does NOT cover

Stated plainly so the pass is not read as broader than it is.

1. **The `service_role` path is unverified.** Testing it requires the
   `service_role` key, which was deliberately never requested or handled. The
   functional billing-path check remains outstanding.
2. **The write-side role matrix (0015) was probed once, not exhaustively.** X16
   proves a cross-tenant write is refused. The full per-command matrix across 21
   tables is proven by `tests/005_role_write_matrix.sql` locally only.
3. **Purchase posting, reversal, void-and-reissue and the completeness gate were
   not exercised remotely.** They are covered by suites 001–005 locally.
4. One disposable project, one run.

## 5. Test-harness defects found and fixed

Recorded because they affect how much earlier evidence is worth.

**The `INGREDIENT_A` fixture id was mistyped** when four UUIDs were hand-copied
out of the fixture output: `…-1cb1-…` for `…-1eb1-…`. The control failed with
`Ingredient does not belong to this account` — the ownership cross-check
correctly refusing a nonexistent row. The database was right throughout.

**The first harness scored any HTTP ≥ 400 as "blocked".** A missing function, a
stale PostgREST schema cache, a bad key or a timeout all counted as a successful
security control. That is the wrong default: an RPC that does not exist is not a
defence. Scoring is now three-valued — `blocked` / `LEAKED` / `INCONCLUSIVE` —
and the verdict requires zero inconclusive results.

**Hand-entered ids were removed entirely.** The harness now discovers the fixture
ids from the database via owner A's own session, locating the ingredient through
its price row so it is necessarily the one whose cost is 15.

Under the original harness this run would have printed eleven reassuring
"blocked" lines while the control was silently failing, and four of those probes
were passing an id that matched no row.

## 6. Verdict

The tenant boundary, the cost-role boundary and the service-context defence hold
on real Supabase infrastructure. Blocker A1 is closed, subject to the exclusions
in §4.
