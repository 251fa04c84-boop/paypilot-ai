'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { createPostgresRepository } = require('../lib/postgres-repository');
const { createApp } = require('../server');

const connectionString = process.env.TEST_DATABASE_URL;
const integration = { skip: !connectionString, timeout: 45000 };

async function listen(app) {
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + app.server.address().port;
}
async function close(app) {
  if (app && app.server.listening) await new Promise((resolve, reject) => app.server.close((e) => e ? reject(e) : resolve()));
}

test('real PostgreSQL HTTP routes isolate tenants, serialize captures, dedupe webhooks, and survive pool restart', integration, async () => {
  const pool1 = new Pool({ connectionString, ssl: false, max: 8 });
  const repo1 = createPostgresRepository({ pool: pool1 });
  const beforeRollback = await repo1.withTenant('rls-test-tenant-a', async (tx) => tx.state.invoices.length);
  await assert.rejects(() => repo1.withTenant('rls-test-tenant-a', async (tx) => {
    tx.state.invoices.push({ id: 'must-rollback', client: 'Rollback fixture' });
    await tx.save();
    throw new Error('simulated failed rollout transaction');
  }), /simulated failed rollout transaction/);
  const afterRollback = await repo1.withTenant('rls-test-tenant-a', async (tx) => tx.state.invoices.length);
  assert.equal(afterRollback, beforeRollback, 'a failed transaction must not leave partially persisted application state');
  let captures = 0;
  const paypal = {
    configured: () => true,
    async createOrder() { return { id: 'ORDER-A-TEST-01', approveUrl: 'https://sandbox.example/approve' }; },
    async captureOrder() {
      captures += 1;
      await new Promise((resolve) => setTimeout(resolve, 80));
      return {
        status: 'COMPLETED',
        purchase_units: [{
          reference_id: 'invoice-a',
          payments: { captures: [{
            id: 'CAPTURE-A-TEST-01',
            status: 'COMPLETED',
            amount: { currency_code: 'USD', value: '125.00' }
          }] }
        }]
      };
    },
    async verifyWebhookSignature() { return true; }
  };
  const env = { NODE_ENV: 'test', PAYPAL_WEBHOOK_ID: 'WH-TEST', PAYPAL_CLIENT_ID: 'test', PAYPAL_CLIENT_SECRET: 'test' };
  const appA1 = createApp({ repository: repo1, tenantId: 'rls-test-tenant-a', env, paypal });
  const appA2 = createApp({ repository: repo1, tenantId: 'rls-test-tenant-a', env, paypal });
  const appB = createApp({ repository: repo1, tenantId: 'rls-test-tenant-b', env, paypal });
  let baseA1, baseA2, baseB;
  try {
    [baseA1, baseA2, baseB] = await Promise.all([listen(appA1), listen(appA2), listen(appB)]);
    const [a, b] = await Promise.all([fetch(baseA1 + '/api/invoices'), fetch(baseB + '/api/invoices')]);
    assert.equal((await a.json())[0].id, 'invoice-a');
    assert.equal((await b.json())[0].id, 'invoice-b');

    const created = await fetch(baseA1 + '/api/invoices', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client: 'Restart persistence test', number: 'A-RESTART', amount: 77, currency: 'USD', issueDate: '2026-11-01', dueDate: '2026-11-20' })
    });
    assert.equal(created.status, 201);
    const createdInvoice = await created.json();

    const payment = await fetch(baseA1 + '/api/invoices/invoice-a/pay', { method: 'POST' });
    assert.equal(payment.status, 200);
    const routeClient = await pool1.connect();
    try {
      await routeClient.query('BEGIN');
      await routeClient.query("SELECT set_config('app.tenant_id',$1,true)", ['rls-test-tenant-a']);
      const routeRow = await routeClient.query('SELECT order_id,tenant_id,invoice_id FROM public.paypilot_paypal_order_routes WHERE order_id=$1', ['ORDER-A-TEST-01']);
      assert.equal(routeRow.rows.length, 1);
      assert.equal(routeRow.rows[0].tenant_id, 'rls-test-tenant-a');
      await routeClient.query('COMMIT');
    } finally { routeClient.release(); }

    const captureBody = JSON.stringify({ orderId: 'ORDER-A-TEST-01' });
    const [captureA, captureB] = await Promise.all([
      fetch(baseA1 + '/api/paypal/capture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: captureBody }),
      fetch(baseA2 + '/api/paypal/capture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: captureBody })
    ]);
    assert.equal(captureA.status, 200);
    assert.equal(captureB.status, 200);
    assert.equal(captures, 1);

    const webhook = {
      id: 'WH-EVENT-ATOMIC-01',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: 'CAPTURE-A-TEST-01', supplementary_data: { related_ids: { order_id: 'ORDER-A-TEST-01' } } }
    };
    const webhookHeaders = {
      'content-type': 'application/json',
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-cert-url': 'https://api-m.sandbox.paypal.com/cert',
      'paypal-transmission-id': 'transmission-test',
      'paypal-transmission-sig': 'signature-test',
      'paypal-transmission-time': '2026-11-09T00:00:00Z'
    };
    const [eventA, eventB] = await Promise.all([
      fetch(baseA1 + '/api/paypal/webhook', { method: 'POST', headers: webhookHeaders, body: JSON.stringify(webhook) }),
      fetch(baseA2 + '/api/paypal/webhook', { method: 'POST', headers: webhookHeaders, body: JSON.stringify(webhook) })
    ]);
    assert.equal(eventA.status, 200);
    assert.equal(eventB.status, 200);
    const eventResults = await Promise.all([eventA.json(), eventB.json()]);
    assert.equal(eventResults.filter((x) => x.duplicate).length, 1);

    await close(appA1); await close(appA2); await close(appB);
    await pool1.end();

    // A new pool and app instance simulate a process restart.
    const pool2 = new Pool({ connectionString, ssl: false, max: 4 });
    try {
      const repo2 = createPostgresRepository({ pool: pool2 });
      const restarted = createApp({ repository: repo2, tenantId: 'rls-test-tenant-a', env, paypal });
      const baseRestarted = await listen(restarted);
      try {
        const response = await fetch(baseRestarted + '/api/invoices');
        const rows = await response.json();
        assert.equal(response.status, 200);
        assert.ok(rows.some((row) => row.id === createdInvoice.id));
        assert.equal(rows.find((row) => row.id === 'invoice-a').status, 'paid');
      } finally { await close(restarted); }
    } finally { await pool2.end(); }
  } finally {
    await close(appA1); await close(appA2); await close(appB);
    if (!pool1.ended) await pool1.end();
  }
});
