'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPostgresRepository, normalizeState, TenantNotFoundError } = require('../lib/postgres-repository');

function fakePool({ tenantExists = true, state = { invoices: [{ id: 'a' }] }, version = 4 } = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('SELECT tenant_id FROM paypilot_tenants')) return { rows: tenantExists ? [{ tenant_id: params[0] }] : [] };
      if (sql.includes('SELECT state, version FROM paypilot_tenant_state')) return { rows: [{ state, version }] };
      if (sql.includes('UPDATE paypilot_tenant_state')) return { rows: [{ version: version + 1 }] };
      return { rows: [] };
    },
    release() { calls.push({ sql: 'RELEASE' }); }
  };
  return { calls, async connect() { return client; }, async query(sql, params = []) { calls.push({ sql, params }); return { rows: [] }; } };
}

test('normalizes JSON state without sharing mutable default arrays', () => {
  const a = normalizeState({});
  const b = normalizeState({});
  assert.deepEqual(a.invoices, []);
  assert.notEqual(a.invoices, b.invoices);
});

test('tenant transactions bind RLS context, lock one tenant state, and commit versioned updates', async () => {
  const pool = fakePool();
  const repo = createPostgresRepository({ pool, clock: () => new Date('2026-11-08T00:00:00Z') });
  const result = await repo.withTenant('tenant-a', async (tx) => {
    assert.equal(tx.version, 4);
    assert.equal(tx.state.invoices[0].id, 'a');
    tx.state.invoices.push({ id: 'b' });
    return tx.save();
  });
  assert.equal(result, 5);
  assert.ok(pool.calls.some((x) => x.sql.includes("set_config('app.tenant_id'")));
  assert.ok(pool.calls.some((x) => x.sql.includes('FOR UPDATE')));
  assert.ok(pool.calls.some((x) => x.sql === 'COMMIT'));
  assert.ok(pool.calls.some((x) => x.sql === 'RELEASE'));
});

test('rolls back and releases the connection when tenant resolution fails', async () => {
  const pool = fakePool({ tenantExists: false });
  const repo = createPostgresRepository({ pool });
  await assert.rejects(() => repo.withTenant('missing', async () => 'never'), TenantNotFoundError);
  assert.ok(pool.calls.some((x) => x.sql === 'ROLLBACK'));
  assert.ok(pool.calls.some((x) => x.sql === 'RELEASE'));
});

test('rejects tenantless repository operations and invalid tenant kinds', async () => {
  const repo = createPostgresRepository({ pool: fakePool() });
  await assert.rejects(() => repo.withTenant('', async () => null), TenantNotFoundError);
  await assert.rejects(() => repo.createTenant({ tenantId: 'x', kind: 'admin' }), /tenant kind/);
});
