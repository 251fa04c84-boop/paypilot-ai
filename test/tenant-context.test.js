'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionToken } = require('../lib/session');
const { createTenantContextResolver, createJudgeDemoContext } = require('../lib/tenant-context');

const secret = 'test-session-secret-long-enough-for-hmac-256';

test('resolves a tenant only from a valid signed cookie and persisted session hash', async () => {
  const now = 1700000000000;
  const token = createSessionToken({ secret, now });
  let receivedHash;
  const resolve = createTenantContextResolver({
    secret, now: () => now,
    repository: { async resolveSession(hash) { receivedHash = hash; return { tenantId: 'tenant-a', userId: 'user-a' }; } }
  });
  const ctx = await resolve({ cookie: 'theme=dark; pp_session=' + token.token });
  assert.equal(ctx.tenantId, 'tenant-a');
  assert.equal(ctx.kind, 'private');
  assert.equal(ctx.userId, 'user-a');
  assert.equal(receivedHash, token.sessionHash);
  assert.equal(Object.isFrozen(ctx), true);
});

test('fails closed for absent, tampered, expired, or unpersisted sessions', async () => {
  const now = 1700000000000;
  const token = createSessionToken({ secret, now });
  const resolve = createTenantContextResolver({
    secret, now: () => now,
    repository: { async resolveSession() { return null; } }
  });
  assert.equal(await resolve({}), null);
  assert.equal(await resolve({ cookie: 'pp_session=' + token.token.slice(0, -1) + '0' }), null);
  const expiredResolve = createTenantContextResolver({
    secret, now: () => (token.expiresAt + 1) * 1000,
    repository: { async resolveSession() { throw new Error('must not query expired session'); } }
  });
  assert.equal(await expiredResolve({ cookie: 'pp_session=' + token.token }), null);
  assert.equal(await resolve({ cookie: 'pp_session=' + token.token }), null);
});

test('judge demo context comes from server configuration, not request data', () => {
  const ctx = createJudgeDemoContext('judge_demo');
  assert.deepEqual(ctx, { tenantId: 'judge_demo', kind: 'judge_demo' });
  assert.equal(Object.isFrozen(ctx), true);
  assert.throws(() => createJudgeDemoContext(''));
});
