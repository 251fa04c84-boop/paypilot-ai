'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const { createStore } = require('../lib/store');

async function boot(env, paypal) {
  const app = createApp({
    env: Object.assign({
      NODE_ENV: 'production',
      APP_BASE_URL: 'https://paypilot-ai-pg-staging.onrender.com',
      ENABLE_PUBLIC_DEMO_MUTATIONS: 'false',
      PAYPAL_WEBHOOK_ID: 'WEBHOOK-TEST-123456',
      PAYPAL_WEBHOOK_SIMULATOR_ENABLED: 'true',
    }, env),
    store: createStore(null),
    paypal,
    now: () => new Date('2026-11-12T06:00:00.000Z'),
  });
  await new Promise((resolve) => app.server.listen(0, resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const call = async (method, path, body, headers = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, headers),
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await response.json(); } catch (_) {}
    return { status: response.status, json };
  };
  return { app, call, close: () => app.server.close() };
}

const mockHeaders = {
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-cert-url': 'https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-test',
  'paypal-transmission-id': 'sim-transmission-123',
  'paypal-transmission-sig': 'c2lnbmF0dXJl',
  'paypal-transmission-time': '2026-11-12T06:00:00Z',
};
const mockEvent = {
  id: 'WH-SIM-123',
  event_type: 'PAYMENT.CAPTURE.COMPLETED',
  resource: { id: 'CAPTURE-SIM-123', status: 'COMPLETED' },
};

test('PayPal simulator event reaches the real webhook route, verifies signature, and never settles an invoice', async () => {
  let receivedSignature;
  const paypal = {
    configured: () => true,
    async verifyWebhookSignature() { return false; }, // PayPal documents that mock events fail postback verification.
    async verifySimulatorWebhookSignature(signature) {
      receivedSignature = signature;
      return signature.rawBody.includes('"PAYMENT.CAPTURE.COMPLETED"');
    },
  };
  const t = await boot({}, paypal);
  try {
    const result = await t.call('POST', '/api/paypal/webhook', mockEvent, mockHeaders);
    assert.equal(result.status, 200);
    assert.equal(result.json.verified, true);
    assert.equal(result.json.simulation, true);
    assert.equal(receivedSignature.rawBody.startsWith('{"id":"WH-SIM-123"'), true);
    const trust = await t.call('GET', '/api/trust');
    assert.equal(trust.json.controls.webhookSimulatorVerified, true);
    assert.equal(trust.json.controls.webhookDeliveryVerified, false);
    assert.equal(trust.json.webhookSimulatorVerifiedAt, '2026-11-12T06:00:00.000Z');
    assert.equal(t.app.db.invoices.length, 0, 'mock event must not create or settle invoices');
    assert.equal(t.app.db.processedWebhookEvents.length, 0, 'mock event must not enter the payment settlement ledger');
  } finally { t.close(); }
});

test('simulator signature fallback is disabled outside the explicit staging test window', async () => {
  const paypal = {
    configured: () => true,
    async verifyWebhookSignature() { return false; },
    async verifySimulatorWebhookSignature() { throw new Error('must not run'); },
  };
  const t = await boot({ PAYPAL_WEBHOOK_SIMULATOR_ENABLED: 'false' }, paypal);
  try {
    const result = await t.call('POST', '/api/paypal/webhook', mockEvent, mockHeaders);
    assert.equal(result.status, 401);
    const trust = await t.call('GET', '/api/trust');
    assert.equal(trust.json.controls.webhookSimulatorVerified, false);
  } finally { t.close(); }
});
