'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPostgresStore } = require('../lib/postgres-store');

function fakeRepository() {
  const states = new Map();
  const calls = [];
  return {
    states, calls,
    async withTenant(tenantId, work) {
      const state = structuredClone(states.get(tenantId) || {
        invoices: [], drafts: [], orders: [], actions: [], proposals: [], settings: {}, processedWebhookEvents: []
      });
      let saved = false;
      const result = await work({
        state,
        async save(next) {
          saved = true;
          states.set(tenantId, structuredClone(next));
          calls.push({ tenantId, state: structuredClone(next) });
        }
      });
      if (!saved) calls.push({ tenantId, readOnly: true });
      return result;
    }
  };
}

test('request store isolates tenant state across overlapping async requests', async () => {
  const repository = fakeRepository();
  const a = createPostgresStore({ repository, tenantId: 'tenant-a' });
  const b = createPostgresStore({ repository, tenantId: 'tenant-b' });
  await Promise.all([
    a.runInTenant(async () => {
      a.db.invoices.push({ id: 'invoice-a' });
      await new Promise((resolve) => setTimeout(resolve, 15));
      a.save();
    }),
    b.runInTenant(async () => {
      b.db.invoices.push({ id: 'invoice-b' });
      b.save();
    })
  ]);
  assert.deepEqual(repository.states.get('tenant-a').invoices, [{ id: 'invoice-a' }]);
  assert.deepEqual(repository.states.get('tenant-b').invoices, [{ id: 'invoice-b' }]);
});

test('request store persists only when the handler explicitly saves', async () => {
  const repository = fakeRepository();
  const store = createPostgresStore({ repository, tenantId: 'tenant-a' });
  await store.runInTenant(async () => { store.db.invoices.push({ id: 'not-persisted' }); });
  assert.equal(repository.states.has('tenant-a'), false);
  await store.runInTenant(async () => { store.db.invoices.push({ id: 'persisted' }); store.save(); });
  assert.deepEqual(repository.states.get('tenant-a').invoices, [{ id: 'persisted' }]);
});

test('request store persists explicitly saved state even when the handler returns an error', async () => {
  const repository = fakeRepository();
  const store = createPostgresStore({ repository, tenantId: 'tenant-a' });
  await assert.rejects(() => store.runInTenant(async () => {
    store.db.actions.push({ type: 'blocked' });
    store.save();
    throw new Error('expected route error');
  }), /expected route error/);
  assert.deepEqual(repository.states.get('tenant-a').actions, [{ type: 'blocked' }]);
});

test('request store rejects reads and writes outside a tenant transaction', () => {
  const repository = fakeRepository();
  const store = createPostgresStore({ repository, tenantId: 'tenant-a' });
  assert.throws(() => store.db.invoices, /outside a tenant request/);
  assert.throws(() => store.save(), /outside a tenant request/);
});

test('request store rejects missing tenant configuration', () => {
  assert.throws(() => createPostgresStore({ repository: fakeRepository() }), /tenant ID/);
});
