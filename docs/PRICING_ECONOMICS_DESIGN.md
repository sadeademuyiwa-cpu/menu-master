# PRICING ECONOMICS — TAX, COMMISSION, PERIOD CLOSE

Design for the owner rulings of 25 Aug: **D3 commission applies to economics**,
**D5 tax option A**, **D6 period close option A**. Design only — no migration
written yet, nothing deployed.

Migration sequence (each independently reversible, none combined):

| # | Migration | Contents |
|---|---|---|
| `0022`–`0025` | Gate 2 phases 2–5 | unchanged; `0025` also adds the deferred `chk_complete_requires_resolution` |
| `0026` | `billing_events` | Gate 3, renumbered from the design's `0019` |
| `0027` | channel commission in economics | D3 |
| `0028` | tax semantics | D5 |
| `0029` | period close enforcement | D6 |
| `0030` | costing-method change audit | D4 |

---

## 1. Notation

`c` cost per portion · `m` target margin (fraction) · `k` `commission_pct`/100 ·
`t` `tax_rate`/100. All four already exist in the schema; none is invented.

## 2. Tax semantics (D5, approved)

Exactly the three `tax_mode` values that exist. No rates, categories, filing
rules or jurisdictional logic are introduced.

| Mode | Stored `recipe_prices.price` means | Net used for revenue and margin |
|---|---|---|
| `none` | the price, no tax | `net = price` |
| `exclusive` | the **net** price; tax is added at sale | `net = price`, customer pays `price × (1 + t)` |
| `inclusive` | the **gross** price, tax already inside | `net = price / (1 + t)` |

**Every economic figure — revenue, COGS coverage, profit, margin — is computed
on `net`.** Tax collected is never revenue and never margin. `v_sales_unified`
gains a derived `net_revenue`; the existing `revenue` column keeps its current
meaning so nothing downstream silently changes.

## 3. Commission (D3, approved)

`commission_pct` is currently stored and selected in `v_price_check` but enters
no calculation (audit item 27). It becomes real: the channel's cut reduces what
the business actually receives, so margin is computed on receipts after
commission.

## 4. Recommended price that preserves the target margin

Required receipts, net of both tax and commission: `R = c / (1 − m)`.

**`exclusive`** — customer pays `G = net × (1 + t)`:

```
net = c / [ (1 − m) × ( (1 + t)(1 − k) − t ) ]
```

**`inclusive`** — the stored price *is* `G`:

```
G = c / [ (1 − m) × ( (1 − k) − t/(1 + t) ) ]
```

**`none`** — `t = 0`, both collapse to `price = c / [ (1 − m)(1 − k) ]`.

The result is rounded up to `price_rounding_to`, exactly as today.

**Refusal condition.** If the bracketed denominator is ≤ 0 the target margin is
unreachable at that commission and tax rate. The engine returns **no**
recommended price and the named problem code `target_unreachable`. It does not
return a negative or an enormous number, and it does not quietly lower the
target. This follows the existing completeness-gate pattern: no answer beats a
wrong answer.

## 5. ⚠️ ONE DECISION THIS DESIGN CANNOT MAKE

**Does channel commission apply to the gross amount the customer pays, or to
the net-of-tax amount?**

The repository defines `channels.commission_pct` and nothing else — no
statement of the base it applies to. The formulas above assume **gross**, and
that assumption is load-bearing: at 20 % commission and 7.5 % tax the two
readings differ by about 1.5 % of the price, which is real money at scale.

- **Option A — commission on gross** (assumed above). Delivery platforms
  normally charge on the full transaction value including tax.
- **Option B — commission on net.** The channel takes its cut only of the
  business's own revenue, not of tax being collected for someone else.

**Recommendation: A**, because it matches how the platforms actually invoice.
**If you choose B**, `(1 − k)` moves inside the tax term and I will restate both
formulas before writing `0028`.

## 6. Period close (D6, approved — option A, no reopening)

Recovered from the repository first, as instructed:

- `period_closes` already stores `period_start`, `period_end`, the closing
  figures, `closed_at` and `closed_by`, with `unique (business_id, period_start,
  period_end)`.
- `0015` already grants INSERT to `owner, accountant` and creates **no UPDATE
  and no DELETE policy** — its comment reads *"a closed period never silently
  changes."* The close record is therefore already append-only by design.

What is missing is only the writer and the enforcement.

**`fn_close_period(business_id, period_start, period_end)`** — SECURITY DEFINER,
authorised through `fn_require_account_role(..., array['owner','accountant'])`,
derives the figures from `v_profit_by_period` and inserts one row. Closing an
already-closed period is refused by the existing unique constraint.

**Enforcement:** a BEFORE INSERT OR UPDATE OR DELETE trigger on `sales_entries`,
`orders`, `order_lines` and `purchases` refuses any row whose business date
falls inside a closed period.

**No reopening, and no `period_reopens` table.** A correction affecting a closed
period is expressed the way the architecture already expresses every other
correction: `fn_void_sales_entry` / `fn_void_order` / `fn_reverse_purchase`
write a **dated reversal in the current open period**. History is never edited;
the correction is visible as its own event. This is the `0014` pattern, extended
rather than duplicated.

## 7. Costing-method change audit (D4, approved)

`costing_method_changes` exists and is never written to. `0030` adds an AFTER
UPDATE trigger on `business_settings` that writes `from_method`, `to_method`,
`effective_from` and the actor whenever `costing_method` changes — the same
append-only shape `0021` already established for `serving_format_changes`.
Historical snapshots keep the method that produced them, so nothing is
recomputed.

## 8. Test requirements

| Area | Must prove |
|---|---|
| Tax | all three modes; margin computed on net in every case; tax never counted as revenue |
| Commission | margin falls when commission rises; recommended price rises to compensate |
| Both | `target_unreachable` returned rather than a nonsense price |
| Period close | a write dated inside a closed period is refused on all four tables; a reversal in the open period succeeds |
| Method audit | a method change writes exactly one dated row; historical snapshots unchanged |
| Regression | the full 154-check suite still passes after each migration |
