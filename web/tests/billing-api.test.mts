/**
 * Every answer /api/billing gives (subscribe/billing-api.ts), branch by branch.
 *
 * Cancel plan cannot be undone, so the route refuses anything that is not our
 * own page asking for one of the two actions, refuses a known non-owner before
 * anything leaves Vercel, answers not_configured while the web's safety switch
 * is off, and never lets a platform's own message reach the screen.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  originAllowed, isJson, billingRequest, billingCaller, manageAnswer,
} from '../src/app/(app)/subscribe/billing-api.ts'

const HOSTS = ['menumasterng.com', 'menumasterng.com']
const ok = {
  origin: 'https://menumasterng.com',
  ownHosts: HOSTS,
  fetchSite: 'same-origin',
  contentType: 'application/json',
  rawBody: '{"action":"cancel"}',
  selfServe: true,
}

test('the Origin, when sent, must be one of our hosts', () => {
  assert.equal(originAllowed(null, HOSTS), true)
  assert.equal(originAllowed(undefined, HOSTS), true)
  assert.equal(originAllowed('', HOSTS), true)
  assert.equal(originAllowed('https://menumasterng.com', HOSTS), true)
  assert.equal(originAllowed('https://MenuMasterNG.com', HOSTS), true)
  assert.equal(originAllowed('http://127.0.0.1:3100', ['127.0.0.1:3100']), true)
  assert.equal(originAllowed('https://evil.example', HOSTS), false)
  assert.equal(originAllowed('https://menumasterng.com.evil.example', HOSTS), false)
  assert.equal(originAllowed('https://sub.menumasterng.com', HOSTS), false)
  assert.equal(originAllowed('null', HOSTS), false)
  assert.equal(originAllowed('not a url', HOSTS), false)
  assert.equal(originAllowed('file://menumasterng.com', HOSTS), false)
  assert.equal(originAllowed('https://menumasterng.com', [null, undefined, '']), false)
})

test('the body must be sent as JSON', () => {
  assert.equal(isJson('application/json'), true)
  assert.equal(isJson('application/json; charset=utf-8'), true)
  assert.equal(isJson('Application/JSON'), true)
  for (const t of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', '', null, undefined]) {
    assert.equal(isJson(t), false, String(t))
  }
})

test('a request from our own page for one of the two actions goes on', () => {
  assert.deepEqual(billingRequest(ok), { action: 'cancel' })
  assert.deepEqual(billingRequest({ ...ok, rawBody: '{"action":"card_link"}' }), { action: 'card_link' })
  // No Origin and no Sec-Fetch-Site (an older browser) is still ours.
  assert.deepEqual(billingRequest({ ...ok, origin: null, fetchSite: null }), { action: 'cancel' })
})

test('another site is refused before anything else is looked at', () => {
  const bad = { refuse: { status: 403, body: { error: 'bad_origin' } } }
  assert.deepEqual(billingRequest({ ...ok, origin: 'https://evil.example' }), bad)
  assert.deepEqual(billingRequest({ ...ok, fetchSite: 'cross-site' }), bad)
  // Even with the switch off and a bad body: the origin is checked first.
  assert.deepEqual(billingRequest({ ...ok, origin: 'https://evil.example', selfServe: false, rawBody: 'x' }), bad)
})

test('a body that is not JSON, or not one of the two actions, is a bad request', () => {
  assert.deepEqual(billingRequest({ ...ok, contentType: 'text/plain' }), { refuse: { status: 415, body: { error: 'bad_request' } } })
  assert.deepEqual(billingRequest({ ...ok, contentType: null }), { refuse: { status: 415, body: { error: 'bad_request' } } })
  for (const rawBody of ['', 'not json', 'null', '[]', '{}', '{"action":"refund"}', '{"action":"CANCEL"}']) {
    assert.deepEqual(billingRequest({ ...ok, rawBody }), { refuse: { status: 400, body: { error: 'bad_request' } } }, rawBody)
  }
})

test('with the web safety switch off, every good request is answered not_configured', () => {
  for (const rawBody of ['{"action":"cancel"}', '{"action":"card_link"}']) {
    assert.deepEqual(billingRequest({ ...ok, rawBody, selfServe: false }),
      { refuse: { status: 500, body: { error: 'not_configured' } } })
  }
})

test('the caller: signed in, and not a known non-owner', () => {
  assert.equal(billingCaller({ contextStatus: 'ok', role: 'owner', hasSession: true }), null)
  // A failed lookup leaves the role unknown: the edge function decides.
  assert.equal(billingCaller({ contextStatus: 'error', role: undefined, hasSession: true }), null)
  assert.deepEqual(billingCaller({ contextStatus: 'unauthenticated', role: undefined, hasSession: false }),
    { status: 401, body: { error: 'unauthorised' } })
  for (const role of ['manager', 'accountant', 'kitchen', 'sales']) {
    assert.deepEqual(billingCaller({ contextStatus: 'ok', role, hasSession: true }),
      { status: 403, body: { error: 'owner_only' } }, role)
  }
  assert.deepEqual(billingCaller({ contextStatus: 'ok', role: 'owner', hasSession: false }),
    { status: 401, body: { error: 'unauthorised' } })
})

test('a contract success is rebuilt field by field', () => {
  assert.deepEqual(manageAnswer('cancel', 200, { ok: true, action: 'cancel', ends_on: '2026-11-18' }),
    { status: 200, body: { ok: true, action: 'cancel', ends_on: '2026-11-18' } })
  assert.deepEqual(manageAnswer('cancel', 200, { ok: true, action: 'cancel', ends_on: '2026-11-18T22:59:59.000Z', extra: 'x' }),
    { status: 200, body: { ok: true, action: 'cancel', ends_on: '2026-11-18T22:59:59.000Z' } })
  assert.deepEqual(manageAnswer('cancel', 200, { ok: true, action: 'cancel', ends_on: null }),
    { status: 200, body: { ok: true, action: 'cancel', ends_on: null } })
  // An ends_on that is not a date is dropped, not passed on.
  assert.deepEqual(manageAnswer('cancel', 200, { ok: true, ends_on: '<b>soon</b>' }),
    { status: 200, body: { ok: true, action: 'cancel', ends_on: null } })
  assert.deepEqual(manageAnswer('card_link', 200, { ok: true, action: 'card_link', link: 'https://paystack.com/manage/x' }),
    { status: 200, body: { ok: true, action: 'card_link', link: 'https://paystack.com/manage/x' } })
})

test('a success that does not fit the contract is a Paystack error', () => {
  const bad = { status: 502, body: { error: 'paystack_error' }, outside: true }
  // A card link that is not https, or missing.
  assert.deepEqual(manageAnswer('card_link', 200, { ok: true, link: 'http://paystack.com/x' }), bad)
  assert.deepEqual(manageAnswer('card_link', 200, { ok: true, link: 'javascript:alert(1)' }), bad)
  assert.deepEqual(manageAnswer('card_link', 200, { ok: true }), bad)
  // The answer for the other action.
  assert.deepEqual(manageAnswer('cancel', 200, { ok: true, action: 'card_link', link: 'https://paystack.com/x' }), bad)
  // 2xx without ok:true, or with no JSON.
  assert.deepEqual(manageAnswer('cancel', 200, { done: true }), bad)
  assert.deepEqual(manageAnswer('cancel', 200, null), bad)
  assert.deepEqual(manageAnswer('cancel', 204, 'text'), bad)
})

test('a contract error passes straight through, with its status', () => {
  for (const [status, error] of [[401, 'unauthorised'], [403, 'owner_only'], [409, 'nothing_to_cancel'],
    [409, 'no_subscription'], [409, 'change_in_progress'], [409, 'switch_needs_support'], [500, 'not_configured'],
    [502, 'paystack_error'], [400, 'bad_request']] as const) {
    assert.deepEqual(manageAnswer('cancel', status, { error }), { status, body: { error } }, error)
  }
})

test('anything else becomes a fixed code, so no platform message reaches the screen', () => {
  // The function is not deployed: the gateway's own 404.
  assert.deepEqual(manageAnswer('cancel', 404, { code: 'NOT_FOUND', message: 'Requested function was not found' }),
    { status: 500, body: { error: 'not_configured' }, outside: true })
  assert.deepEqual(manageAnswer('card_link', 404, null), { status: 500, body: { error: 'not_configured' }, outside: true })
  // The gateway refused the token.
  assert.deepEqual(manageAnswer('cancel', 401, { msg: 'Invalid JWT' }), { status: 401, body: { error: 'unauthorised' }, outside: true })
  // An error that is a sentence, not a code.
  assert.deepEqual(manageAnswer('cancel', 500, { error: 'Internal Server Error: relation does not exist' }),
    { status: 502, body: { error: 'paystack_error' }, outside: true })
  assert.deepEqual(manageAnswer('cancel', 503, null), { status: 502, body: { error: 'paystack_error' }, outside: true })
  // A 2xx carrying an error is not a success.
  assert.deepEqual(manageAnswer('cancel', 200, { error: 'owner_only' }), { status: 502, body: { error: 'paystack_error' }, outside: true })
})
