# D-5 / D-6 — PRODUCT BOUNDARY AND PACKAGING

**RULED 27 Aug 2026 — Option A, with revised packaging. DESIGN ONLY.**
No migration, no policy altered, no pricing-page change.

> **Level 1 / Costing answers "what should I charge?"**
> **Level 2 / Costing + Sales answers "what did I actually sell, buy and earn?"**

---

## 1. The boundary

| Level 1 — Costing | Level 2 — adds |
|---|---|
| units · conversions · ingredient categories · ingredients · suppliers · **ingredient prices** · business settings · recipes · recipe lines · labour rates · recipe labour · overheads · cost snapshots · serving formats · recipe variants · format packaging · **channels** · **recipe prices / recommended pricing** | **customers · orders · order_lines · sales_entries · purchases · purchase_lines · period_closes** |

Two rulings that resolve the arguable cases:

- **`purchases` / `purchase_lines` are Level 2.** The distinction is not "anything
  about ingredients is costing": *maintaining the input prices costing needs* is
  Level 1 (`ingredient_prices`, `suppliers`); *recording actual supplier
  transactions* is a commercial record and belongs with trading.
- **`recipe_prices` and recommended pricing stay Level 1**, explicitly **not**
  moved to manufacture an upgrade incentive. Costing must be a complete, useful
  product in its own right — take away "what should I charge?" and it stops
  answering the question it exists for.

## 2. Packaging (D-6)

| | `level` | businesses | users | recipes |
|---|---|---|---|---|
| **Free Trial** | 1 | 1 | 2 | **20** |
| **Costing — ₦3,500** | 1 | **2** | 3 | unlimited |
| **Costing + Sales — ₦7,500** | 2 | 3 | 10 | unlimited |

**`businesses` on Costing rises from 1 to 2**, deliberately. A small food
entrepreneur running two brands from one kitchen should not have to buy the Sales
product to create a second business record. The ₦4,000 must buy materially
greater operational capability — sales, customers, purchases, trading records —
not another name slot.

This is a **change to the `0010` seed**, which is data, not schema.

---

## 3. RLS reconciliation — every affected write path

Read from the migrations, and every count below is **to be re-verified against
live `pg_policies` at migration time**, not trusted from this reading.

### 3.1 The structure this plugs into

`0001` created one blanket `p_<t>` policy `for all` per tenant table. **`0015`
replaced that** with up to four separate policies per table —
`p_<t>_select`, `p_<t>_insert`, `p_<t>_update`, `p_<t>_delete` — created only
where that table grants the verb to at least one role. `0028` then appended the
entitlement conjunct to policies matching `^p_.*_(insert|update|delete)$`,
which is why **no SELECT policy was touched**.

Level 2 enforcement uses **exactly the same additive technique**: ALTER the
existing write policies to carry one more conjunct. No policy is created or
dropped, the policy count does not move, and reads are structurally untouched —
which is what delivers the approved downgrade behaviour without a special case.

### 3.2 Policies to be altered

From `0015`'s role spec, the seven Level 2 tables carry these write policies:

| Table | insert | update | delete | count |
|---|:---:|:---:|:---:|---:|
| `customers` | ✅ | ✅ | ✅ | 3 |
| `orders` | ✅ | ✅ | ✅ | 3 |
| `order_lines` | ✅ | ✅ | ✅ | 3 |
| `purchases` | ✅ | ✅ | ✅ | 3 |
| `purchase_lines` | ✅ | ✅ | ✅ | 3 |
| `sales_entries` | ✅ | — | — | 1 |
| `period_closes` | ✅ | — | — | 1 |
| | | | **total** | **17** |

`sales_entries` and `period_closes` are append-only by design — `0015` granted
no UPDATE or DELETE to any role — so they have one write policy each. **A
migration that expects 21 has misread the schema.**

The conjunct: `fn_plan_level(account_id) >= 2`, where `fn_plan_level` resolves
through **`fn_effective_plan(account_id)`**, never `subscriptions.plan_id`. That
is what makes a scheduled downgrade take effect on the approved boundary rather
than when J1 happens to run.

### 3.3 Numeric limits need triggers, not policies

A policy cannot count sibling rows cleanly. `businesses`, `memberships` and
`recipes` get `before insert` triggers comparing the current count against
`plan_features.limit_value` for the effective plan.

| Table | Limit | Note |
|---|---|---|
| `businesses` | 1 / 2 / 3 | counts non-deleted rows (`deleted_at is null`) |
| `memberships` | 2 / 3 / 10 | **`memberships` is excluded from `0028`'s entitlement gate on purpose** — an owner locked out of adding a manager cannot fix their own billing. A *limit* check is a different control and may apply, but it must never block an owner from managing access to sort out a lapse. |
| `recipes` | 20 / ∞ / ∞ | `limit_value is null` means unlimited — **NULL must not be read as zero** |

### 3.4 Over-limit is not a violation

A Costing + Sales customer with 3 businesses who downgrades to Costing's 2 is
**over limit, not in breach**:

- nothing is deleted, hidden, or arbitrarily chosen;
- all three businesses stay readable **and usable** for Level 1 work;
- **no new business may be created** until they are within the limit or upgrade.

This falls out of the design rather than needing a special case: the trigger
fires on **INSERT only** and compares `count(*) >= limit`. Existing rows are
never re-validated. The account is flagged over-limit for creation purposes and
that is the whole of the effect.

### 3.5 Reads survive downgrade

`0028`'s precedent, now load-bearing for the product promise: **every `SELECT`
stays open, permanently.** A downgraded customer reads and exports every order,
customer, purchase and period close they ever recorded. They simply cannot record
new ones. No SELECT policy is altered by this work.

### 3.6 A defect found while reconciling — to be verified, not assumed

`0015`'s role spec does **not** include `recipe_prices`, so that table never
received `p_recipe_prices_insert/_update/_delete` policies and appears to still
carry `0001`'s blanket `p_recipe_prices` `for all` policy. `0028` selected
policies by the name pattern `^p_.*_(insert|update|delete)$`, so a blanket policy
would not have matched.

**If that reading is right, `recipe_prices` writes are not entitlement-gated** —
a lapsed account could still write recommended prices. That is a C4 remnant, not
a D-5 issue (`recipe_prices` is Level 1 either way), and it should be closed in
`0034` alongside the entitlement work.

Verify before acting on it — read-only:

```sql
select tablename, policyname, cmd,
       (coalesce(qual,'') || coalesce(with_check,'')) like '%fn_account_is_entitled%'
         as entitlement_gated
  from pg_policies
 where schemaname = 'public'
   and tablename in ('recipe_prices','channels','cost_snapshots','subscriptions')
 order by tablename, policyname;
```

## 4. Deterministic errors, not opaque RLS failures

An RLS denial surfaces as a bare permission error with nothing a customer could
act on. Every limit is therefore enforced by a **trigger that raises a named
error**, so the frontend can say something true:

| Code | Message |
|---|---|
| `plan_limit_businesses` | "You've reached the 2-business limit on Costing." |
| `plan_limit_users` | "You've reached the 3-user limit on Costing." |
| `plan_limit_recipes` | "Free Trial includes 20 recipes." |
| `plan_level_required` | "Sales recording is available on Costing + Sales." |

Each carries the limit, the current count and the plan, so the message is
generated from data rather than hard-coded per plan — the packaging can change
without touching copy.

`plan_level_required` is the awkward one: an RLS `WITH CHECK` failure cannot
carry a custom code. So Level 2 tables get a **`before insert` trigger** raising
`plan_level_required` *in addition to* the policy conjunct. The trigger produces
the good message; **the policy is the actual security boundary** and holds even
if a trigger is ever disabled. Belt and braces, with the braces load-bearing.

## 5. Trial specifics

- **Recipe 21 is refused cleanly** with `plan_limit_recipes`, naming the limit and
  the upgrade — never a silent failure or a bare constraint error.
- **Trial → paid Costing removes the cap with nothing to migrate.** The limit is
  evaluated at insert time against the effective plan; the 20 existing recipes
  are untouched, unmarked and not recreated. There is no per-recipe state to
  change, which is precisely why the limit must be a count-at-insert rather than
  anything stamped on the rows.

## 6. What this blocks and what it needs

Blocks **`0038`**. Needs `fn_effective_plan` from `0033`, so it cannot precede it.

The frontend must treat every limit as **advisory** — hiding a button is a
courtesy, never the control. The server refuses regardless, which is what makes
"authoritative server rules, not cosmetic frontend restrictions" true.
