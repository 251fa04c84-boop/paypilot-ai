'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionToken, verifySessionToken, readCookie, serializeSessionCookie, clearSessionCookie } = require('../lib/session');

const secret = 'test-only-session-secret-with-more-than-32-bytes';

test('creates an opaque, signed session token and a one-way database reference', () => {
  const created = createSessionToken({ secret, now: 1700000000000 });
  assert.match(created.sessionId, /^[a-f0-9]{64}$/);
  assert.match(created.sessionHash, /^[a-f0-9]{64}$/);
  assert.notEqual(created.sessionId, created.sessionHash);
  assert.deepEqual(verifySessionToken(created.token, { secret, now: 1700000000000 }), {
    sessionId: created.sessionId,
    sessionHash: created.sessionHash,
    expiresAt: created.expiresAt
  });
});

test('rejects tampered, expired, malformed, and incorrectly signed tokens', () => {
  const created = createSessionToken({ secret, now: 1700000000000 });
  assert.equal(verifySessionToken(created.token + '0', { secret, now: 1700000000000 }), null);
  assert.equal(verifySessionToken(created.token, { secret: 'different-secret-with-more-than-32-bytes', now: 1700000000000 }), null);
  assert.equal(verifySessionToken(created.token, { secret, now: (created.expiresAt + 1) * 1000 }), null);
  assert.equal(verifySessionToken('not-a-token', { secret, now: 1700000000000 }), null);
});

test('fails closed for missing or weak secrets and unreasonable TTLs', () => {
  assert.throws(() => createSessionToken({ secret: 'short' }), /SESSION_SECRET/);
  assert.throws(() => createSessionToken({ secret, ttlSeconds: 30 }), /TTL/);
  assert.equal(verifySessionToken('v1.' + 'a'.repeat(64) + '.9999999999.' + 'b'.repeat(64), { secret: 'short' }), null);
});

test('cookie parsing rejects duplicate session cookies and oversized headers', () => {
  assert.equal(readCookie('theme=dark; pp_session=one'), 'one');
  assert.equal(readCookie('pp_session=one; pp_session=two'), null);
  assert.equal(readCookie('x'.repeat(8193)), null);
});

test('serializes secure HttpOnly SameSite=Lax cookies and clears them safely', () => {
  const created = createSessionToken({ secret, now: 1700000000000 });
  const cookie = serializeSessionCookie(created.token);
  assert.match(cookie, /^pp_session=v1\./);
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; Secure/);
  assert.match(cookie, /; SameSite=Lax/);
  assert.match(clearSessionCookie(), /Max-Age=0/);
  assert.doesNotMatch(serializeSessionCookie(created.token, { secure: false }), /; Secure/);
});
