/**
 * What each moment is called by Meta and Google, and the cookie that carries
 * a server-side moment to the browser. The cookie is readable and editable by
 * the visitor, so whatever comes out of it is checked again.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  metaCall, googleAdsConversion, encodeQueue, decodeQueue, isAppEvent,
  sourceFromUrl, encodeSource, decodeSource,
} from '../src/lib/analytics/events.ts'
import { parseAnalytics } from '../src/lib/site/settings.ts'

test('the moments ads optimise for use Meta\'s standard events', () => {
  assert.deepEqual(metaCall('sign_up'), ['track', 'CompleteRegistration', {}])
  assert.deepEqual(metaCall('setup_completed'), ['track', 'StartTrial', { value: 0, currency: 'NGN' }])
  assert.deepEqual(metaCall('checkout_started', { value: 7500, plan: 'costing' }),
    ['track', 'InitiateCheckout', { value: 7500, currency: 'NGN', content_name: 'costing' }])
  assert.deepEqual(metaCall('subscription_activated', { value: 15000 }),
    ['track', 'Subscribe', { value: 15000, currency: 'NGN' }])
  assert.deepEqual(metaCall('sale_recorded'), ['trackCustom', 'sale_recorded', {}])
})

test('Google Ads reports a conversion only where the admin set its label', () => {
  const none = parseAnalytics({})
  assert.equal(googleAdsConversion('sign_up', none), null)
  const a = parseAnalytics({ google_ads_id: 'AW-123456789', google_ads_signup_label: 'SignUpLbl' })
  assert.deepEqual(googleAdsConversion('sign_up', a), { send_to: 'AW-123456789/SignUpLbl' })
  assert.equal(googleAdsConversion('subscription_activated', a), null)   // no purchase label
  assert.equal(googleAdsConversion('sale_recorded', a), null)
})

test('server-side moments survive the cookie', () => {
  const v = encodeQueue([{ e: 'business_created', p: {} }, { e: 'subscription_activated', p: { value: 7500, plan: 'costing' } }])
  assert.match(v, /^[A-Za-z0-9_-]+$/)
  assert.deepEqual(decodeQueue(v), [
    { e: 'business_created', p: {} },
    { e: 'subscription_activated', p: { value: 7500, plan: 'costing' } },
  ])
})

test('a tampered cookie yields nothing it should not', () => {
  assert.deepEqual(decodeQueue('not base64 !!'), [])
  assert.deepEqual(decodeQueue(undefined), [])
  const forged = encodeQueue([
    { e: 'drop_tables' as never, p: {} },
    { e: 'sign_up', p: { value: -5, plan: '<script>', email: 'a@b.c' } as never },
  ])
  assert.deepEqual(decodeQueue(forged), [{ e: 'sign_up', p: {} }])
})

test('only the known moments are events', () => {
  assert.equal(isAppEvent('sign_up'), true)
  assert.equal(isAppEvent('anything'), false)
})

test('the ad that brought a visitor is read from the first page', () => {
  const s = sourceFromUrl(new URL('https://menumasterng.com/?utm_source=facebook&utm_campaign=launch&fbclid=abc&x=1'))
  assert.deepEqual(s, { utm_source: 'facebook', utm_campaign: 'launch', fbclid: 'abc', landing: '/' })
  assert.equal(sourceFromUrl(new URL('https://menumasterng.com/login')), null)
  assert.deepEqual(decodeSource(encodeSource(s!)), s)
  assert.equal(decodeSource('%%%'), null)
})
