import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROLES, roleLabel, statusWords, inviteLink, inviteMessage, canManage } from '../src/lib/people/format.ts'

test('an owner can never be offered as an invitation role', () => {
  assert.ok(!(ROLES as readonly string[]).includes('owner'))
  assert.equal(ROLES.length, 4)
})

test('roles read as words, unknown ones fall through', () => {
  assert.equal(roleLabel('sales'), 'Sales')
  assert.equal(roleLabel('owner'), 'Owner')
  assert.equal(roleLabel('something'), 'something')
})

test('every invitation status has words and a tone', () => {
  for (const s of ['pending', 'accepted', 'revoked', 'expired'] as const) {
    const w = statusWords(s)
    assert.ok(w.label.length > 0, s)
  }
  assert.equal(statusWords('accepted').tone, 'good')
  assert.equal(statusWords('expired').tone, 'warn')
})

test('the invite link points at signup with the address filled in, and survives a trailing slash', () => {
  assert.equal(inviteLink('https://menumasterng.com/', 'cook@x.ng'), 'https://menumasterng.com/signup?email=cook%40x.ng')
})

test('the message names the business, the address and the link', () => {
  const m = inviteMessage('Ada Kitchen', 'cook@x.ng', 'https://menumasterng.com')
  assert.ok(m.includes('Ada Kitchen') && m.includes('cook@x.ng') && m.includes('/signup?email=cook%40x.ng'))
})

test('only an owner manages people, and never their own row', () => {
  assert.equal(canManage('owner', false), true)
  assert.equal(canManage('owner', true), false)
  assert.equal(canManage('manager', false), false)
  assert.equal(canManage(undefined, false), false)
})
