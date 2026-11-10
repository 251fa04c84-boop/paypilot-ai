'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPostgresRepository } = require('../lib/postgres-repository');

test('password reset updates the actual password_updated_at column and revokes sessions atomically', async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('SELECT r.user_id, u.tenant_id')) {
        return { rows: [{ user_id: 'user-1', tenant_id: 'acct_tenant-1' }] };
      }
      return { rows: [] };
    },
    release() { calls.push({ sql: 'RELEASE', params: [] }); }
  };
  const adminPool = {
    async connect() { return client; },
    async query() { return { rows: [] }; }
  };
  const repo = createPostgresRepository({ pool: { connect: async () => { throw new Error('runtime pool must not be used'); } }, adminPool });
  const changed = await repo.consumePasswordReset({
    tokenHash: 'a'.repeat(64),
    passwordHash: 'scrypt$16384$8$1$' + 'b'.repeat(32) + '$' + 'c'.repeat(128)
  });

  assert.equal(changed, true);
  const passwordUpdate = calls.find((call) => call.sql.includes('UPDATE paypilot_users SET password_hash'));
  assert.ok(passwordUpdate, 'password hash update must execute');
  assert.match(passwordUpdate.sql, /password_updated_at\s*=\s*now\(\)/);
  assert.doesNotMatch(passwordUpdate.sql, /(?:^|,\s*)updated_at\s*=\s*now\(\)/);
  assert.deepEqual(passwordUpdate.params, ['user-1', 'scrypt$16384$8$1$' + 'b'.repeat(32) + '$' + 'c'.repeat(128)]);
  assert.ok(calls.some((call) => call.sql.includes('UPDATE paypilot_password_resets SET consumed_at')));
  assert.ok(calls.some((call) => call.sql.includes('UPDATE paypilot_sessions SET revoked_at')));
  assert.ok(calls.some((call) => call.sql === 'COMMIT'));
  assert.ok(calls.some((call) => call.sql === 'RELEASE'));
});

test('password reset rejects malformed token hashes without opening a transaction', async () => {
  let connected = false;
  const repo = createPostgresRepository({
    pool: { connect: async () => { throw new Error('runtime pool must not be used'); } },
    adminPool: { connect: async () => { connected = true; return { query: async () => ({ rows: [] }), release() {} }; } }
  });
  assert.equal(await repo.consumePasswordReset({ tokenHash: 'invalid', passwordHash: 'unused' }), false);
  assert.equal(connected, false);
});
