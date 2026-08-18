# Menu Master NG: Inventory, Production and Profitability Engine (Design)

This is the design only. No database has been changed. It layers on top of the relational foundation already approved (businesses, ingredients, recipes, menu items, customers, orders), and adds the inventory, purchasing, production, and costing brain that answers your fifteen questions.

The flow it supports: **purchase, inventory, recipe, production, consumption, order, cost, profit.**

---

## THE CORE PRINCIPLE: THE LEDGER IS THE TRUTH

We never store a "current stock" number that someone types in. Instead, every movement of stock is recorded as a permanent entry in a ledger, and current stock is always calculated by adding up those entries. This means stock can never silently drift, every number can be traced to a real event, and nothing can be quietly edited. Purchases add stock. Production and orders consume it. Waste and corrections adjust it. The ledger is the single source of truth.

---

## NEW TABLES (added to the existing foundation)

### purchases (a purchase receipt)
* Purpose: one buying event from a supplier.
* Key: id. Foreign keys: business_id, supplier_id.
* Fields: purchase_date, reference, total_cost, notes.

### purchase_items (what was bought, at what price)
* Purpose: each ingredient on a receipt, with the real price paid.
* Key: id. Foreign keys: purchase_id, ingredient_id.
* Fields: quantity, unit, unit_cost, total_cost.
* Effect: each line creates a stock lot and a purchase entry in the ledger. This is where the true cost of each ingredient enters the system.

### stock_lots (cost history, batch by batch)
* Purpose: each batch of an ingredient received, kept separate so its exact cost is known even as prices change.
* Key: id. Foreign keys: business_id, ingredient_id, purchase_item_id.
* Fields: received_date, quantity_received, quantity_remaining, unit_cost, base_unit.
* Answers: what did this ingredient actually cost, and what is our inventory worth.

### inventory_movements (THE LEDGER, permanent and auditable)
* Purpose: every single stock movement, in or out, ever.
* Key: id. Foreign keys: business_id, ingredient_id, lot_id.
* Fields: movement_type (purchase_in, production_consume, waste, adjustment, return, opening_balance), quantity_signed (positive in, negative out), unit_cost, value, reference_type (purchase, production, order, adjustment), reference_id, reason, created_by, created_at.
* Rule: append only. Never edited or deleted. A correction is a new entry, not a rewrite.

### production_batches (making a dish)
* Purpose: a record of producing a quantity of a recipe.
* Key: id. Foreign keys: business_id, recipe_id.
* Fields: quantity_produced, yield_unit, produced_date, ingredient_cost, packaging_cost, labour_cost, overhead_cost, total_cost, cost_per_unit, status (planned, completed, cancelled), notes.
* Effect: on completion, it consumes the required ingredients from stock lots (writing consumption entries to the ledger) and calculates the real cost per portion from the actual lot costs used.

### finished_goods_lots (only if you cook to stock, for example meal prep)
* Purpose: portions produced and held ready to sell.
* Key: id. Foreign keys: business_id, menu_item_id, production_batch_id.
* Fields: quantity_produced, quantity_remaining, unit_cost, produced_date.
* Note: used only for produce to stock. For cook to order, orders consume ingredients directly and this stays empty.

**Reused from the foundation, now doing more:**
* recipes and recipe_ingredients become your Bill of Materials (BOM): each recipe lists exactly what and how much it needs per yield.
* orders and order_items now carry a real cost captured at the moment of sale, so profit is calculated, never guessed.
* order_cost_lines and the recipe cost fields hold packaging, labour, gas, and transport.
* suppliers link purchases to who you bought from.

---

## COSTING METHOD

Recommended: **first in, first out (FIFO) by lot.** When stock is consumed, it is drawn from the oldest lot first, at that lot's actual price. This gives the truest cost of goods and correctly reflects price changes, which matters in a volatile market. Inventory value is simply the remaining quantity in each lot times that lot's price.

A simpler alternative, weighted average cost, is available if you prefer one blended price per ingredient. FIFO is the more accurate default and answers your cost driver questions better, so it is my recommendation, with weighted average as a setting.

---

## HOW IT ANSWERS YOUR FIFTEEN QUESTIONS

1. What stock do we have: add up the ledger entries per ingredient, or the remaining quantity across its lots.
2. Quantity of each ingredient: the same, per ingredient.
3. What each ingredient actually cost: the unit cost on its lots and purchase items, with full price history.
4. Current inventory value: for every lot, remaining quantity times its unit cost, summed.
5. Stock consumed: sum of the consumption entries in the ledger, for any period.
6. Stock wasted or adjusted: sum of the waste and adjustment entries, each with a reason and who made it.
7. What we can produce now: for each recipe, check every BOM line against available stock. If all are covered, we can make it.
8. How many units of a dish: for each BOM line, divide available stock by the amount the dish needs, and take the smallest result across all lines.
9. Exact cost to produce a dish: sum each BOM ingredient times its real lot cost, plus packaging, labour, and overhead, divided by the yield.
10. Cost of each order: sum the cost of every item on it, plus that order's packaging and labour lines.
11. Selling price of an order: sum the item prices, less discount, plus delivery.
12. Gross profit and margin of an order: revenue minus cost, and that profit divided by revenue.
13. Which ingredients drive food cost up: compare purchase prices over time, weighted by how much of each you actually use, to surface the real movers.
14. Which dishes are profitable: each dish's cost against its price, ranked from best to worst margin.
15. Most profitable customers, orders, products: add up realised profit grouped by customer, by order, and by dish.

Every one of these reads from the ledger and the lots, so every answer is real and traceable, not typed in.

---

## TWO PRODUCTION MODES (the design supports both)

* Cook to order: an order triggers consumption of ingredients directly. Simple, no finished goods held. Best for most caterers and soup sellers.
* Cook to stock: production makes portions into finished goods, and orders draw them down. Best for meal prep and pastries made ahead.

A business setting picks the default, and a dish can override it.

---

## HONEST COUNSEL (founder to founder)

This design is sound, and it is genuinely powerful. It is also, honestly, a large system, the kind that sits under a serious food operation. Two things I owe you before you approve it:

1. **Scope is growing faster than shipping.** In the space of these sessions, Menu Master NG has grown from a pricing app to a costing SaaS, then to a relational rebuild, and now to a full inventory and production engine. Each step is well reasoned. But right now you have a live, paying app, and a stack of excellent approved designs that have not yet been built, because the migration itself still needs to run on your real database, which needs a developer. Designs do not earn money. Shipped features do.

2. **My recommendation on sequence.** Get a developer, run the base migration we already designed and proved, ship one visible round of value on it, and put it in front of real vendors. Then layer this inventory engine as its own phase once the foundation is live and you have learned what your first customers actually use. Building the whole brain before the first customer has stress tested the base is the riskiest way to spend your time and money.

3. **The good news.** These design documents are a genuinely strong specification. A competent developer could pick them up and move fast, because the thinking is already done. That is real value you have created, and it is exactly what shortens the build and lowers the cost when you hire.

So: this engine is the right destination. My honest advice is to build the foundation first, prove it with customers, then add this. Either way, nothing here is wasted.

---

Nothing has been built or changed. This is the design for your review. Tell me whether you want to fold this into the plan now or after the base is live, and I will fit it into the sequence accordingly.
