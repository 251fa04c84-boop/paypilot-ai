'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createPostgresRepository, normalizeState, TenantNotFoundError } = require('../lib/postgres-repository');

function fakePool({
  tenantExists = true,
  state = { invoices: [{ id: 'a' }] },
  version = 4,
  orderInserted = true,
  webhookInserted = true,
  webhookProcessed = true,
  session = null
} = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ scope: 'client', sql, params });
      if (sql.includes('SELECT tenant_id FROM paypilot_tenants')) return { rows: tenantExists ? [{ tenant_id: params[0] }] : [] };
      if (sql.includes('SELECT state, version FROM paypilot_tenant_state')) return { rows: [{ state, version }] };
      if (sql.includes('UPDATE paypilot_tenant_state')) return { rows: [{ version: version + 1 }] };
      if (sql.includes('INSERT INTO paypilot_paypal_order_routes')) return { rows: orderInserted ? [{ order_id: params[0] }] : [] };
      if (sql.includes('INSERT INTO paypilot_webhook_events')) return { rows: webhookInserted ? [{ event_id: params[0] }] : [] };
      if (sql.includes('UPDATE paypilot_webhook_events')) return { rows: webhookProcessed ? [{ event_id: params[0] }] : [] };
      if (sql.includes('INSERT INTO paypilot_sessions')) return { rows: [{ session_hash: params[0] }] };
      if (sql.includes('UPDATE paypilot_sessions')) return { rows: [{ session_hash: params[0] }] };
      return { rows: [] };
    },
    release() { calls.push({ scope: 'client', sql: 'RELEASE' }); }
  };
  return {
    calls,
    async connect() { return client; },
    async query(sql, params = []) {
      calls.push({ scope: 'pool', sql, params });
      if (sql.includes('paypilot_resolve_session')) return { rows: session ? [{ tenant_id: session.tenantId }] : [] };
      if (sql.includes('paypilot_resolve_order_route')) {
        return { rows: [{ order_id: params[0], tenant_id: 'tenant-a', invoice_id: 'invoice-a', proposal_id: null, status: 'created' }] };
      }
      return { rows: [] };
    }
  };
}

test('account provisioning is atomic and checks separate admin/runtime permissions', async () => {
  const runtime = fakePool();
  const adminCalls = [];
  const adminClient = {
    async query(sql, params = []) {
      adminCalls.push({ sql, params });
      if (sql.includes('INSERT INTO paypilot_users')) return { rows: [{ user_id: 'user-uuid', tenant_id: params[0], email: params[1] }] };
      return { rows: [] };
    },
    release() { adminCalls.push({ sql: 'RELEASE' }); }
  };
  const adminPool = {
    async connect() { return adminClient; },
    async query(sql) {
      adminCalls.push({ sql });
      if (sql.includes('has_table_privilege')) return { rows: [{ tenant_insert: true, state_insert: true, user_insert: true, user_select: true, tenant_select: true }] };
      return { rows: [] };
    }
  };
  runtime.query = async (sql, params = []) => {
    runtime.calls.push({ scope: 'pool', sql, params });
    if (sql.includes('has_table_privilege')) return { rows: [{ session_insert: true, session_update: true, resolver_execute: true }] };
    return { rows: [] };
  };
  const repo = createPostgresRepository({ pool: runtime, adminPool });
  assert.equal(repo.accountsEnabled, true);
  assert.equal(await repo.checkAccountProvisioning(), true);
  const user = await repo.createAccount({ tenantId: 'acct_test-uuid', email: 'person@example.com', normalizedEmail: 'person@example.com', passwordHash: 'hash-value-that-is-long-enough-for-test' });
  assert.deepEqual(user, { userId: 'user-uuid', tenantId: 'acct_test-uuid', email: 'person@example.com' });
  assert.ok(adminCalls.some((x) => x.sql === 'BEGIN'));
  assert.ok(adminCalls.some((x) => x.sql.includes('INSERT INTO paypilot_tenants')));
  assert.ok(adminCalls.some((x) => x.sql.includes('INSERT INTO paypilot_tenant_state')));
  assert.ok(adminCalls.some((x) => x.sql.includes('INSERT INTO paypilot_users')));
  const userInsert = adminCalls.find((x) => x.sql.includes('INSERT INTO paypilot_users'));
  assert.match(userInsert.sql, /email_normalized/);
  assert.doesNotMatch(userInsert.sql, /normalized_email(?![a-z_])/);
  assert.ok(adminCalls.some((x) => x.sql === 'COMMIT'));
});

test('session resolver requires account identity and session inserts bind it to the tenant', async () => {
  const pool = fakePool();
  const repo = createPostgresRepository({ pool });
  pool.query = async (sql, params = []) => {
    pool.calls.push({ scope: 'pool', sql, params });
    if (sql.includes('paypilot_resolve_session')) return { rows: [{ tenant_id: 'acct_a', user_id: 'user-a' }] };
    return { rows: [] };
  };
  assert.deepEqual(await repo.resolveSession('a'.repeat(64)), { tenantId: 'acct_a', userId: 'user-a' });
  await repo.createSession({ sessionHash: 'b'.repeat(64), tenantId: 'acct_a', userId: 'user-a', expiresAt: 1799999999 });
  const insert = pool.calls.find((x) => x.sql.includes('INSERT INTO paypilot_sessions'));
  assert.deepEqual(insert.params, ['b'.repeat(64), 'acct_a', 'user-a', new Date(1799999999 * 1000)]);
});

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
  await assert.rejects(() => repo.createTenant({ tenantId: 'tenant-new' }), /separate administrator pool/);
});

test('registers PayPal order routes inside a tenant transaction and rejects duplicate order IDs', async () => {
  const pool = fakePool();
  const repo = createPostgresRepository({ pool });
  assert.equal(await repo.recordOrderRoute({ orderId: 'order-1', tenantId: 'tenant-a', invoiceId: 'invoice-a' }), true);
  const insert = pool.calls.find((x) => x.sql.includes('INSERT INTO paypilot_paypal_order_routes'));
  assert.deepEqual(insert.params, ['order-1', 'tenant-a', 'invoice-a', null]);
  assert.ok(pool.calls.some((x) => x.sql === 'COMMIT'));

  const duplicate = createPostgresRepository({ pool: fakePool({ orderInserted: false }) });
  await assert.rejects(
    () => duplicate.recordOrderRoute({ orderId: 'order-1', tenantId: 'tenant-a', invoiceId: 'invoice-a' }),
    /already registered/
  );
});

test('looks up a PayPal order route by parameterized order ID', async () => {
  const pool = fakePool();
  const repo = createPostgresRepository({ pool });
  const route = await repo.findOrderRoute('order-1');
  assert.equal(route.tenant_id, 'tenant-a');
  const query = pool.calls.find((x) => x.sql.includes('SELECT order_id, tenant_id'));
  assert.deepEqual(query.params, ['order-1']);
  assert.ok(query.sql.includes('paypilot_resolve_order_route($1)'));
});

test('records webhook event idempotently and hashes the original payload', async () => {
  const payload = { resource: { id: 'capture-1' }, event_type: 'PAYMENT.CAPTURE.COMPLETED' };
  const pool = fakePool();
  const repo = createPostgresRepository({ pool });
  assert.equal(await repo.recordWebhook({ eventId: 'evt-1', tenantId: 'tenant-a', orderId: 'order-1', eventType: 'PAYMENT.CAPTURE.COMPLETED', payload }), true);
  const insert = pool.calls.find((x) => x.sql.includes('INSERT INTO paypilot_webhook_events'));
  assert.equal(insert.params[0], 'evt-1');
  assert.equal(insert.params[4], crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex'));
  assert.ok(insert.sql.includes('ON CONFLICT (event_id) DO NOTHING'));

  const duplicate = createPostgresRepository({ pool: fakePool({ webhookInserted: false }) });
  assert.equal(await duplicate.recordWebhook({ eventId: 'evt-1', tenantId: 'tenant-a', eventType: 'PAYMENT.CAPTURE.COMPLETED', payload }), false);
});

test('only allows supported webhook terminal states and marks received events once', async () => {
  const pool = fakePool();
  const repo = createPostgresRepository({ pool, clock: () => new Date('2026-11-08T00:00:00Z') });
  assert.equal(await repo.markWebhookProcessed('evt-1', 'tenant-a', 'processed'), true);
  const update = pool.calls.find((x) => x.sql.includes('UPDATE paypilot_webhook_events'));
  assert.deepEqual(update.params, ['evt-1', 'processed', new Date('2026-11-08T00:00:00Z'), null]);
  assert.ok(update.sql.includes("status = 'received'"));
  await assert.rejects(() => repo.markWebhookProcessed('evt-2', 'tenant-a', 'anything'), /Invalid webhook status/);
});

test('session lookup rejects malformed hashes and returns only an active tenant ID', async () => {
  const pool = fakePool({ session: { tenantId: 'tenant-a' } });
  const repo = createPostgresRepository({ pool });
  assert.equal(await repo.resolveSession('bad-hash'), null);
  assert.equal(pool.calls.length, 0);
  assert.deepEqual(await repo.resolveSession(validHash), { tenantId: 'tenant-a' });
  const query = pool.calls.find((x) => x.sql.includes('paypilot_resolve_session'));
  assert.deepEqual(query.params[0], validHash);
  assert.ok(query.sql.includes('paypilot_resolve_session($1, $2)'));
});

test('session creation rejects malformed hashes before writing', async () => {
  const pool = fakePool();
  const repo = createPostgresRepository({ pool });
  await assert.rejects(() => repo.createSession({ sessionHash: 'not-a-hash', tenantId: 'tenant-a', expiresAt: 1800000000 }), /Invalid session hash/);
  assert.equal(pool.calls.length, 0);
});

test('persists order routing and webhook replay keys in the tenant transaction', async () => {
  const pool = fakePool({
    state: {
      invoices: [{ id: 'invoice-a' }],
      orders: [{ orderId: 'order-a', invoiceId: 'invoice-a', proposalId: 'proposal-a', status: 'created' }, { orderId: 'order-pending', invoiceId: 'invoice-a', status: 'pending' }],
      processedWebhookEvents: [{ id: 'event-a', at: '2026-11-09T10:00:00.000Z' }]
    }
  });
  const repo = createPostgresRepository({ pool });
  await repo.withTenant('tenant-a', async (tx) => tx.save());
  const orderInsert = pool.calls.find((x) => x.sql.includes('INSERT INTO paypilot_paypal_order_routes'));
  assert.deepEqual(orderInsert.params, ['order-a', 'tenant-a', 'invoice-a', 'proposal-a', 'created']);
  assert.ok(orderInsert.sql.includes('WHERE paypilot_paypal_order_routes.tenant_id = EXCLUDED.tenant_id'));
  const pendingInsert = pool.calls.find((x) => x.sql.includes('INSERT INTO paypilot_paypal_order_routes') && x.params[0] === 'order-pending');
  assert.equal(pendingInsert.params[4], 'pending');
  const eventInsert = pool.calls.find((x) => x.sql.includes('INSERT INTO paypilot_webhook_events'));
  assert.deepEqual(eventInsert.params, ['event-a', 'tenant-a', new Date('2026-11-09T10:00:00.000Z')]);
  assert.ok(eventInsert.sql.includes('ON CONFLICT (event_id) DO NOTHING'));
  assert.ok(pool.calls.some((x) => x.sql.includes('UPDATE paypilot_tenant_state')));
});

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
  await assert.rejects(() => repo.createTenant({ tenantId: 'tenant-new' }), /separate administrator pool/);
});

test('registers PayPal order routes inside a tenant transaction and rejects duplicate order IDs', async () => {
  const pool = fakePool();
  const repo = createPostgresRepository({ pool });
  assert.equal(await repo.recordOrderRoute({ orderId: 'order-1', tenantId: 'tenant-a', invoiceId: 'invoice-a' }), true);
  const insert = pool.calls.find((x) => x.sql.includes('INSERT INTO paypilot_paypal_order_routes'));
  assert.deepEqual(insert.params, ['order-1', 'tenant-a', 'invoice-a', null]);
  assert.ok(pool.calls.some((x) => x.sql === 'COMMIT'));

  const duplicate = createPostgresRepository({ pool: fakePool({ orderInserted: false }) });
  await assert.rejects(
    () => duplicate.recordOrderRoute({ orderId: 'order-1', tenantId: 'tenant-a', invoiceId: 'invoice-a' }),
    /already registered/
  );
});

test('looks up a PayPal order route by parameterized order ID', async () => {
  const pool = fakePool();
  const repo = createPostgresRepository({ pool });
  const route = await repo.findOrderRoute('order-1');
  assert.equal(route.tenant_id, 'tenant-a');
  const query = pool.calls.find((x) => x.sql.includes('SELECT order_id, tenant_id'));
  assert.deepEqual(query.params, ['order-1']);
  assert.ok(query.sql.includes('paypilot_resolve_order_route($1)'));
});

test('records webhook event idempotently and hashes the original payload', async () => {
  const payload = { resource: { id: 'capture-1' }, event_type: 'PAYMENT.CAPTURE.COMPLETED' };
  const pool = fakePool();
  const repo = createPostgresRepository({ pool });
  assert.equal(await repo.recordWebhook({ eventId: 'evt-1', tenantId: 'tenant-a', orderId: 'order-1', eventType: 'PAYMENT.CAPTURE.COMPLETED', payload }), true);
  const insert = pool.calls.find((x) => x.sql.includes('INSERT INTO paypilot_webhook_events'));
  assert.equal(insert.params[0], 'evt-1');
  assert.equal(insert.params[4], crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex'));
  assert.ok(insert.sql.includes('ON CONFLICT (event_id) DO NOTHING'));

  const duplicate = createPostgresRepository({ pool: fakePool({ webhookInserted: false }) });
  assert.equal(await duplicate.recordWebhook({ eventId: 'evt-1', tenantId: 'tenant-a', eventType: 'PAYMENT.CAPTURE.COMPLETED', payload }), false);
});

test('only allows supported webhook terminal states and marks received events once', async () => {
  const pool = fakePool();
  const repo = createPostgresRepository({ pool, clock: () => new Date('2026-11-08T00:00:00Z') });
  assert.equal(await repo.markWebhookProcessed('evt-1', 'tenant-a', 'processed'), true);
  const update = pool.calls.find((x) => x.sql.includes('UPDATE paypilot_webhook_events'));
  assert.deepEqual(update.params, ['evt-1', 'processed', new Date('2026-11-08T00:00:00Z'), null]);
  assert.ok(update.sql.includes("status = 'received'"));
  await assert.rejects(() => repo.markWebhookProcessed('evt-2', 'tenant-a', 'anything'), /Invalid webhook status/);
});

test('session lookup rejects malformed hashes and returns only an active tenant ID', async () => {
  const pool = fakePool({ session: { tenantId: 'tenant-a' } });
  const repo = createPostgresRepository({ pool });
  assert.equal(await repo.resolveSession('bad-hash'), null);
  assert.equal(pool.calls.length, 0);
  assert.deepEqual(await repo.resolveSession(validHash), { tenantId: 'tenant-a' });
  const query = pool.calls.find((x) => x.sql.includes('paypilot_resolve_session'));
  assert.deepEqual(query.params[0], validHash);
  assert.ok(query.sql.includes('paypilot_resolve_session($1, $2)'));
});

test('session creation rejects malformed hashes before writing', async () => {
  const pool = fakePool();
  const repo = createPostgresRepository({ pool });
  await assert.rejects(() => repo.createSession({ sessionHash: 'not-a-hash', tenantId: 'tenant-a', expiresAt: 1800000000 }), /Invalid session hash/);
  assert.equal(pool.calls.length, 0);
});

test('persists order routing and webhook replay keys in the tenant transaction', async () => {
  const pool = fakePool({
    state: {
      invoices: [{ id: 'invoice-a' }],
      orders: [{ orderId: 'order-a', invoiceId: 'invoice-a', proposalId: 'proposal-a', status: 'created' }, { orderId: 'order-pending', invoiceId: 'invoice-a', status: 'pending' }],
      processedWebhookEvents: [{ id: 'event-a', at: '2026-11-09T10:00:00.000Z' }]
    }
  });
  const repo = createPostgresRepository({ pool });
  await repo.withTenant('tenant-a', async (tx) => tx.save());
  const orderInsert = pool.calls.find((x) => x.sql.includes('INSERT INTO paypilot_paypal_order_routes'));
  assert.deepEqual(orderInsert.params, ['order-a', 'tenant-a', 'invoice-a', 'proposal-a', 'created']);
  assert.ok(orderInsert.sql.includes('WHERE paypilot_paypal_order_routes.tenant_id = EXCLUDED.tenant_id'));
  const pendingInsert = pool.calls.find((x) => x.sql.includes('INSERT INTO paypilot_paypal_order_routes') && x.params[0] === 'order-pending');
  assert.equal(pendingInsert.params[4], 'pending');
  const eventInsert = pool.calls.find((x) => x.sql.includes('INSERT INTO paypilot_webhook_events'));
  assert.deepEqual(eventInsert.params, ['event-a', 'tenant-a', new Date('2026-11-09T10:00:00.000Z')]);
  assert.ok(eventInsert.sql.includes('ON CONFLICT (event_id) DO NOTHING'));
  assert.ok(pool.calls.some((x) => x.sql.includes('UPDATE paypilot_tenant_state')));
});

const validHash = 'a'.repeat(64);

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
  await assert.rejects(() => repo.createTenant({ tenantId: 'tenant-new' }), /separate administrator pool/);
});

test('registers PayPal order routes inside a tenant transaction and rejects duplicate order IDs', async () => {
  const pool = fakePool();
  const repo = createPostgresRepository({ pool });
  assert.equal(await repo.recordOrderRoute({ orderId: 'order-1', tenantId: 'tenant-a', invoiceId: 'invoice-a' }), true);
  const insert = pool.calls.find((x) => x.sql.includes('INSERT INTO paypilot_paypal_order_routes'));
  assert.deepEqual(insert.params, ['order-1', 'tenant-a', 'invoice-a', null]);
  assert.ok(pool.calls.some((x) => x.sql === 'COMMIT'));

  const duplicate = createPostgresRepository({ pool: fakePool({ orderInserted: false }) });
  await assert.rejects(
    () => duplicate.recordOrderRoute({ orderId: 'order-1', tenantId: 'tenant-a', invoiceId: 'invoice-a' }),
    /already registered/
  );
});

test('looks up a PayPal order route by parameterized order ID', async () => {
  const pool = fakePool();
  const repo = createPostgresRepository({ pool });
  const route = await repo.findOrderRoute('order-1');
  assert.equal(route.tenant_id, 'tenant-a');
  const query = pool.calls.find((x) => x.sql.includes('SELECT order_id, tenant_id'));
  assert.deepEqual(query.params, ['order-1']);
  assert.ok(query.sql.includes('paypilot_resolve_order_route($1)'));
});

test('records webhook event idempotently and hashes the original payload', async () => {
  const payload = { resource: { id: 'capture-1' }, event_type: 'PAYMENT.CAPTURE.COMPLETED' };
  const pool = fakePool();
  const repo = createPostgresRepository({ pool });
  assert.equal(await repo.recordWebhook({ eventId: 'evt-1', tenantId: 'tenant-a', orderId: 'order-1', eventType: 'PAYMENT.CAPTURE.COMPLETED', payload }), true);
  const insert = pool.calls.find((x) => x.sql.includes('INSERT INTO paypilot_webhook_events'));
  assert.equal(insert.params[0], 'evt-1');
  assert.equal(insert.params[4], crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex'));
  assert.ok(insert.sql.includes('ON CONFLICT (event_id) DO NOTHING'));

  const duplicate = createPostgresRepository({ pool: fakePool({ webhookInserted: false }) });
  assert.equal(await duplicate.recordWebhook({ eventId: 'evt-1', tenantId: 'tenant-a', eventType: 'PAYMENT.CAPTURE.COMPLETED', payload }), false);
});

test('only allows supported webhook terminal states and marks received events once', async () => {
  const pool = fakePool();
  const repo = createPostgresRepository({ pool, clock: () => new Date('2026-11-08T00:00:00Z') });
  assert.equal(await repo.markWebhookProcessed('evt-1', 'tenant-a', 'processed'), true);
  const update = pool.calls.find((x) => x.sql.includes('UPDATE paypilot_webhook_events'));
  assert.deepEqual(update.params, ['evt-1', 'processed', new Date('2026-11-08T00:00:00Z'), null]);
  assert.ok(update.sql.includes("status = 'received'"));
  await assert.rejects(() => repo.markWebhookProcessed('evt-2', 'tenant-a', 'anything'), /Invalid webhook status/);
});

test('session lookup rejects malformed hashes and returns only an active tenant ID', async () => {
  const pool = fakePool({ session: { tenantId: 'tenant-a' } });
  const repo = createPostgresRepository({ pool });
  assert.equal(await repo.resolveSession('bad-hash'), null);
  assert.equal(pool.calls.length, 0);
  assert.deepEqual(await repo.resolveSession(validHash), { tenantId: 'tenant-a' });
  const query = pool.calls.find((x) => x.sql.includes('paypilot_resolve_session'));
  assert.deepEqual(query.params[0], validHash);
  assert.ok(query.sql.includes('paypilot_resolve_session($1, $2)'));
});

test('session creation rejects malformed hashes before writing', async () => {
  const pool = fakePool();
  const repo = createPostgresRepository({ pool });
  await assert.rejects(() => repo.createSession({ sessionHash: 'not-a-hash', tenantId: 'tenant-a', expiresAt: 1800000000 }), /Invalid session hash/);
  assert.equal(pool.calls.length, 0);
});

test('persists order routing and webhook replay keys in the tenant transaction', async () => {
  const pool = fakePool({
    state: {
      invoices: [{ id: 'invoice-a' }],
      orders: [{ orderId: 'order-a', invoiceId: 'invoice-a', proposalId: 'proposal-a', status: 'created' }, { orderId: 'order-pending', invoiceId: 'invoice-a', status: 'pending' }],
      processedWebhookEvents: [{ id: 'event-a', at: '2026-11-09T10:00:00.000Z' }]
    }
  });
  const repo = createPostgresRepository({ pool });
  await repo.withTenant('tenant-a', async (tx) => tx.save());
  const orderInsert = pool.calls.find((x) => x.sql.includes('INSERT INTO paypilot_paypal_order_routes'));
  assert.deepEqual(orderInsert.params, ['order-a', 'tenant-a', 'invoice-a', 'proposal-a', 'created']);
  assert.ok(orderInsert.sql.includes('WHERE paypilot_paypal_order_routes.tenant_id = EXCLUDED.tenant_id'));
  const pendingInsert = pool.calls.find((x) => x.sql.includes('INSERT INTO paypilot_paypal_order_routes') && x.params[0] === 'order-pending');
  assert.equal(pendingInsert.params[4], 'pending');
  const eventInsert = pool.calls.find((x) => x.sql.includes('INSERT INTO paypilot_webhook_events'));
  assert.deepEqual(eventInsert.params, ['event-a', 'tenant-a', new Date('2026-11-09T10:00:00.000Z')]);
  assert.ok(eventInsert.sql.includes('ON CONFLICT (event_id) DO NOTHING'));
  assert.ok(pool.calls.some((x) => x.sql.includes('UPDATE paypilot_tenant_state')));
});


test('finds private account credentials without an RLS-filtered tenant join', async () => {
  const runtime = fakePool();
  const calls = [];
  const adminPool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      return { rows: [{ user_id: 'user-1', tenant_id: 'acct-1', email: 'owner@example.com', password_hash: 'scrypt-hash' }] };
    },
    async connect() { throw new Error('not used'); }
  };
  const repo = createPostgresRepository({ pool: runtime, adminPool });
  const user = await repo.findUserByEmail('owner@example.com');
  assert.deepEqual(user, {
    userId: 'user-1', tenantId: 'acct-1', email: 'owner@example.com', passwordHash: 'scrypt-hash'
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ['owner@example.com']);
  assert.match(calls[0].sql, /FROM paypilot_users WHERE email_normalized = \$1 LIMIT 1/);
  assert.doesNotMatch(calls[0].sql, /JOIN\s+paypilot_tenants/i);
});
