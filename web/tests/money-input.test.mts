/**
 * Reading an amount out of a submitted form.
 *
 * The bug these exist for: on 2026-09-02 a live sale of TEST BEEF DISH at
 * 2,000 naira was recorded as a FREE item. The action read the price with
 * Number(formData.get('unit_price')), and Number('') is 0 -- finite, and not
 * negative -- so a blank field passed the guard and was stored as zero.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { requiredAmount, optionalAmount } from '../src/lib/money-input.ts'

const fd = (entries: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.append(k, v)
  return f
}

// --- the exact production failure ------------------------------------------
test('a blank sale price is rejected and cannot become a free line', () => {
  assert.equal(requiredAmount(fd({ unit_price: '' }), 'unit_price'), null)
  // and the old code would have produced 0 from the very same input
  assert.equal(Number(''), 0, 'this is why the old guard let it through')
})

test('a whitespace-only sale price is rejected', () => {
  for (const raw of [' ', '   ', '\t', '\n']) {
    assert.equal(requiredAmount(fd({ unit_price: raw }), 'unit_price'), null, JSON.stringify(raw))
  }
})

test('a missing sale price field is rejected', () => {
  assert.equal(requiredAmount(new FormData(), 'unit_price'), null)
})

test('2000 stores as 2000', () => {
  assert.equal(requiredAmount(fd({ unit_price: '2000' }), 'unit_price'), 2000)
  assert.equal(requiredAmount(fd({ unit_price: '2000.50' }), 'unit_price'), 2000.5)
  assert.equal(requiredAmount(fd({ unit_price: ' 2000 ' }), 'unit_price'), 2000)
})

test('a genuinely typed zero is still accepted, because a free item is real', () => {
  assert.equal(requiredAmount(fd({ unit_price: '0' }), 'unit_price'), 0)
  assert.equal(requiredAmount(fd({ unit_price: '0.00' }), 'unit_price'), 0)
})

test('nonsense and impossible amounts are rejected', () => {
  for (const raw of ['abc', '2,000', '₦2000', '-1', 'Infinity', 'NaN', '1e999']) {
    assert.equal(requiredAmount(fd({ unit_price: raw }), 'unit_price'), null, raw)
  }
})

// --- optional fields keep their old, deliberate meaning ---------------------
test('an optional discount left blank still means zero', () => {
  assert.equal(optionalAmount(fd({ discount_amount: '' }), 'discount_amount'), 0)
  assert.equal(optionalAmount(new FormData(), 'discount_amount'), 0)
  assert.equal(optionalAmount(fd({ discount_amount: '  ' }), 'discount_amount'), 0)
})

test('an optional field still rejects nonsense rather than reading it as zero', () => {
  assert.equal(optionalAmount(fd({ discount_amount: 'abc' }), 'discount_amount'), null)
  assert.equal(optionalAmount(fd({ discount_amount: '-5' }), 'discount_amount'), null)
})

test('an optional field that IS filled in is honoured', () => {
  assert.equal(optionalAmount(fd({ discount_amount: '250' }), 'discount_amount'), 250)
})

// --- the call sites, so the fix cannot be reverted in one file -------------
const src = (f: string) => readFileSync(join(import.meta.dirname, '..', f), 'utf8')

test('the sale line price is read with requiredAmount, not Number()', () => {
  const s = src('src/app/(app)/sales/[id]/page.tsx')
  assert.match(s, /requiredAmount\(formData, 'unit_price'\)/)
  assert.doesNotMatch(s, /Number\(formData\.get\('unit_price'\)\)/)
})

test('a blank recipe selling price cannot silently become zero', () => {
  const s = src('src/app/(app)/recipes/[id]/page.tsx')
  assert.match(s, /requiredAmount\(formData, 'price'\)/)
  assert.doesNotMatch(s, /Number\(formData\.get\('price'\)\)/)
})

test('a blank ingredient purchase amount cannot silently become zero', () => {
  const s = src('src/app/(app)/ingredients/[id]/page.tsx')
  assert.match(s, /requiredAmount\(formData, 'amount'\)/)
  assert.doesNotMatch(s, /Number\(formData\.get\('amount'\)\)/)
})

test('deliberately optional money fields were left alone', () => {
  const s = src('src/app/(app)/sales/[id]/page.tsx')
  for (const f of ['discount_amount', 'order_discount', 'amount_paid']) {
    assert.match(s, new RegExp(`formData\\.get\\('${f}'\\) \\|\\| 0`), f)
  }
})

// --- the prefill ------------------------------------------------------------
test('the sale form offers the price the product is already sold at', () => {
  const page = src('src/app/(app)/sales/[id]/page.tsx')
  // read from the same view the dashboard shows "You charge" from
  assert.match(page, /from\('v_product_attention'\)/)
  assert.match(page, /selling_price/)
  assert.match(page, /<ProductAndPriceFields products=\{productOptions\} \/>/)

  const cmp = src('src/components/product-price-field.tsx')
  // choosing a product fills the price in...
  assert.match(cmp, /products\.find\(\(p\) => p\.value === e\.target\.value\)\?\.price/)
  // ...and the field stays editable, so the actual price charged can differ
  assert.match(cmp, /onChange=\{\(e\) => \{ setTouched\(true\); setPrice\(e\.target\.value\) \}\}/)
  // a price the owner typed is never overwritten by a later product change
  assert.match(cmp, /if \(!touched\) setPrice/)
})
