import type { CostPart } from '@/components/charts'

/**
 * What one portion (or, for a dish sold in sizes, one batch) is made of, as
 * parts for CostBreakdown: each ingredient line, packaging, labour and
 * running costs.
 *
 * NOTHING IS PRICED HERE. Every figure is one the database already worked
 * out: a line's cost from v_recipe_line_costs, the running costs per portion
 * from the snapshot. The only sum is the portion's share of the batch, which
 * is the engine's own (fn__recipe_cost_core: cost_per_yield_unit = batch_cost
 * / (batch_yield_qty x cooking_yield_pct / 100), and fn_compute_recipe_cost_
 * snapshot: cost_per_portion = cost_per_yield_unit x portion_qty + overhead),
 * so the parts add up to the cost per portion the card shows.
 *
 * GOVERNING RULE: a part not known yet stays null, and the chart hatches it
 * "not known yet". It is never 0, and it is never left out to make the bar
 * look finished.
 */

export type PartLine = {
  name: string
  packaging: boolean
  costBearing: boolean
  /** The line's cost for one batch, or null when it cannot be costed yet. */
  lineCost: number | null
}

export type PartLabour = { hours: number; ratePerHour: number | null }

/** One portion's share of a batch, or null when the dish has no portion size. */
export function portionShare(
  portionQty: number | null,
  batchYieldQty: number | null,
  cookingYieldPct: number | null,
): number | null {
  if (portionQty === null || batchYieldQty === null || !(portionQty > 0) || !(batchYieldQty > 0)) return null
  const cooking = cookingYieldPct ?? 100
  if (!(cooking > 0)) return null
  return portionQty / (batchYieldQty * (cooking / 100))
}

export function costParts({
  lines, labour, scale, runningCosts,
}: {
  lines: PartLine[]
  labour: PartLabour[]
  /** 1 for the batch, portionShare() for one portion. */
  scale: number
  /**
   * Running costs for one portion: a number, null when switched on but not
   * known yet, or undefined when switched off or not per portion (a dish sold
   * in sizes carries them per size, not per batch).
   */
  runningCosts?: number | null
}): CostPart[] {
  const part = (label: string, amount: number | null): CostPart =>
    ({ label, amount: amount === null ? null : amount * scale })

  const counted = lines.filter((l) => l.costBearing)
  const food = counted.filter((l) => !l.packaging)
    .map((l) => part(l.name, l.lineCost))
  // Biggest first, as the owner reads it; a part not known yet after them.
  food.sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1))

  const parts: CostPart[] = [...food]

  const packs = counted.filter((l) => l.packaging)
  if (packs.length > 0) {
    const known = packs.every((l) => l.lineCost !== null)
    parts.push(part('Packaging', known ? packs.reduce((t, l) => t + (l.lineCost as number), 0) : null))
  }

  if (labour.length > 0) {
    const known = labour.every((l) => l.ratePerHour !== null)
    parts.push(part('Labour', known
      ? labour.reduce((t, l) => t + l.hours * (l.ratePerHour as number), 0)
      : null))
  }

  // Already per portion: not scaled again.
  if (runningCosts !== undefined) parts.push({ label: 'Running costs', amount: runningCosts })

  return parts
}
