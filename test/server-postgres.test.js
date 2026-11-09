'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');

function repositoryFixture() {
  const states = new Map();
  return {
    states,
    async withTenant(tenantId, work) {
      const state = structuredClone(states.get(tenantId) || {
        invoices: [], drafts: [], orders: [], actions: [], proposals: [], settings: {}, processedWebhookEvents: []
      });
      const result = await work({
        state,
        async save(next) { states.set(tenantId, structuredClone(next)); }
      });
      return result;
    }
  };
}

async function withServer(app, run) {
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  try { await run('http://127.0.0.1:' + address.port); }
  finally { await new Promise((resolve, reject) => app.server.close((e) => e ? reject(e) : resolve())); }
}

test('PostgreSQL mode routes requests through the configured tenant store', async () => {
  const repository = repositoryFixture();
  const app = createApp({ repository, tenantId: 'tenant-a', env: { NODE_ENV: 'test', PORT: '0' } });
  await withServer(app, async (base) => {
    const create = await fetch(base + '/api/invoices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client: 'Tenant A client',
        number: 'A-100',
        amount: 125,
        currency: 'USD',
        issueDate: '2026-11-01',
        dueDate: '2026-11-15'
      })
    });
    assert.equal(create.status, 201);
    const list = await fetch(base + '/api/invoices');
    assert.equal(list.status, 200);
    const invoices = await list.json();
    assert.equal(invoices.length, 1);
    assert.equal(invoices[0].client, 'Tenant A client');
    assert.equal(repository.states.get('tenant-a').invoices.length, 1);
  });
});

test('separate app instances cannot read each other tenant state', async () => {
  const repository = repositoryFixture();
  repository.states.set('tenant-b', {
    invoices: [{ id: 'secret-b', client: 'Tenant B secret', number: 'B-1', amount: 10, currency: 'USD', issueDate: '2026-11-01', dueDate: '2026-11-10', status: 'open' }],
    drafts: [], orders: [], actions: [], proposals: [], settings: {}, processedWebhookEvents: []
  });
  const appA = createApp({ repository, tenantId: 'tenant-a', env: { NODE_ENV: 'test', PORT: '0' } });
  await withServer(appA, async (base) => {
    const response = await fetch(base + '/api/invoices');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  });
  assert.equal(repository.states.get('tenant-b').invoices[0].client, 'Tenant B secret');
});
