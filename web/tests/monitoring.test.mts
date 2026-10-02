/**
 * Error reports are for finding bugs, not people.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blankEmails, scrubEvent } from '../src/lib/monitoring.ts'

test('email addresses in error text are blanked', () => {
  assert.equal(blankEmails('duplicate key for ada.o@kitchen.ng in signup'), 'duplicate key for [email] in signup')
  assert.equal(blankEmails('no address here'), 'no address here')
})

test('a report keeps the error, loses the person', () => {
  const e = scrubEvent({
    message: 'failed for x@y.ng',
    exception: { values: [{ type: 'Error', value: 'insert refused for owner@b.ng' }] },
    request: { cookies: { sb: 'token' }, headers: { cookie: 'sb=token', 'x-forwarded-for': '1.2.3.4' },
               data: { email: 'a@b.ng' }, query_string: 'email=a@b.ng', url: 'https://m.ng/login?email=a@b.ng' },
    user: { ip_address: '1.2.3.4', email: 'a@b.ng' },
    breadcrumbs: [{ message: 'fetch a@b.ng', data: { url: '/x?y=1' } }],
  })
  assert.equal(e.message, 'failed for [email]')
  assert.equal(e.exception!.values![0].value, 'insert refused for [email]')
  assert.equal(e.exception!.values![0].type, 'Error')
  assert.deepEqual(e.request, { url: 'https://m.ng/login' })
  assert.equal(e.user, undefined)
  assert.deepEqual(e.breadcrumbs, [{ message: 'fetch [email]' }])
})
