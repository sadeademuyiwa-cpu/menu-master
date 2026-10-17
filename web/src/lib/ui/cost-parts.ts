/**
 * Which parts of a plate's cost get a stretch of their own on the cost bar
 * (components/charts.tsx CostBreakdown), and which fold into "Everything
 * else". Kept free of React so it can be tested.
 */

export type CostPart = {
  /** "Rice", "Chicken", "Pack", "Labour". */
  label: string
  /** Its share of one portion's cost. Null when not known yet. */
  amount: number | null
}

/** Six shades a bar can tell apart; the rest of a long list is "Everything else". */
export const MAX_COST_PARTS = 6

const known = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n)

/**
 * The parts the bar and its legend show, in the caller's order.
 *
 * A long list keeps its biggest known parts, wherever the caller put them:
 * the dish page lists the food first and Packaging, Labour and Running costs
 * after it, and labour can outweigh most ingredients. The smaller known parts
 * fold into "Everything else", added last. A part not known yet is never
 * folded away: it is the one the owner has to find to finish the costing.
 */
export function foldCostParts(parts: CostPart[]): CostPart[] {
  const unknownCount = parts.filter((p) => !known(p.amount)).length
  const knownParts = parts.filter((p) => known(p.amount))
  const roomForKnown = Math.max(1, MAX_COST_PARTS - unknownCount)
  if (parts.length <= MAX_COST_PARTS || knownParts.length <= roomForKnown) return parts

  // A stable sort, so equal parts keep the caller's order.
  const keep = new Set(
    [...knownParts]
      .sort((a, b) => (b.amount as number) - (a.amount as number))
      .slice(0, roomForKnown - 1),
  )
  const restSum = knownParts
    .filter((p) => !keep.has(p))
    .reduce((t, p) => t + (p.amount as number), 0)
  return parts
    .filter((p) => !known(p.amount) || keep.has(p))
    .concat({ label: 'Everything else', amount: restSum })
}
