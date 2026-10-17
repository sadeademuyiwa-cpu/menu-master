/**
 * The cost bar folds a long list into "Everything else" by size, not by
 * where the caller put each part: the dish page lists the food first and
 * Packaging, Labour and Running costs after it, and labour can be as big as
 * the biggest ingredient. A part not known yet is never folded away.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { foldCostParts, MAX_COST_PARTS, type CostPart } from '../src/lib/ui/cost-parts.ts'

const labels = (parts: CostPart[]) => parts.map((p) => p.label)

// Eight food lines, biggest first as costParts sorts them, then packaging,
// labour as big as the chicken, and running costs: the order the dish page
// hands them over.
const jollof: CostPart[] = [
  { label: 'Chicken', amount: 600 },
  { label: 'Rice', amount: 400 },
  { label: 'Oil', amount: 90 },
  { label: 'Tomato', amount: 80 },
  { label: 'Pepper', amount: 30 },
  { label: 'Onion', amount: 20 },
  { label: 'Stock', amount: 6 },
  { label: 'Salt', amount: 2 },
  { label: 'Packaging', amount: 100 },
  { label: 'Labour', amount: 600 },
  { label: 'Running costs', amount: 120 },
]

test('labour keeps its own row when it is one of the biggest parts', () => {
  const shown = foldCostParts(jollof)
  assert.equal(shown.length, MAX_COST_PARTS)
  // The five biggest, in the caller's order, then everything else.
  assert.deepEqual(labels(shown), ['Chicken', 'Rice', 'Packaging', 'Labour', 'Running costs', 'Everything else'])
  const rest = shown.at(-1)!
  assert.equal(rest.amount, 90 + 80 + 30 + 20 + 6 + 2)
})

test('folding keeps the total', () => {
  const sum = (ps: CostPart[]) => ps.reduce((t, p) => t + (p.amount ?? 0), 0)
  assert.equal(sum(foldCostParts(jollof)), sum(jollof))
})

test('a part not known yet is never folded, wherever it sits', () => {
  const parts: CostPart[] = [...jollof.slice(0, 8), { label: 'Palm oil', amount: null }, ...jollof.slice(8)]
  const shown = foldCostParts(parts)
  assert.ok(labels(shown).includes('Palm oil'))
  assert.equal(shown.find((p) => p.label === 'Palm oil')!.amount, null)
  // One row less for the known parts: four kept, then "Everything else".
  assert.deepEqual(labels(shown), ['Chicken', 'Rice', 'Palm oil', 'Labour', 'Running costs', 'Everything else'])
})

test('a short list is shown as it came', () => {
  const short = jollof.slice(0, MAX_COST_PARTS)
  assert.equal(foldCostParts(short), short)
})

test('equal parts keep the caller order', () => {
  const parts: CostPart[] = Array.from({ length: 8 }, (_, i) => ({ label: `P${i}`, amount: 10 }))
  assert.deepEqual(labels(foldCostParts(parts)), ['P0', 'P1', 'P2', 'P3', 'P4', 'Everything else'])
})
