'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPayPal } = require('../lib/paypal');

function response(status, value, contentLength) {
  return {
    status,
    headers: { get(name) { return name.toLowerCase() === 'content-length' ? (contentLength || null) : null; } },
    async text() { return typeof value === 'string' ? value : JSON.stringify(value); },
  };
}

test('PayPal webhook verifier sends the event and transmission headers to the official verification API', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/v1/oauth2/token')) return response(200, { access_token: 'sandbox-access-token', expires_in: 3600 });
    return response(200, { verification_status: 'SUCCESS' });
  };
  const paypal = createPayPal({ clientId: 'sandbox-client', secret: 'sandbox-secret', fetchImpl });
  const event = { id: 'WH-1', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'ORDER-1' } };
  const verified = await paypal.verifyWebhookSignature({
    authAlgo: 'SHA256withRSA', certUrl: 'https://api-m.sandbox.paypal.com/cert/test',
    transmissionId: 'transmission-1', transmissionSig: 'signature-value',
    transmissionTime: '2026-10-27T12:00:00Z', webhookId: 'webhook-id', webhookEvent: event,
  });
  assert.equal(verified, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer sandbox-access-token');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  const payload = JSON.parse(calls[1].options.body);
  assert.equal(payload.webhook_id, 'webhook-id');
  assert.deepEqual(payload.webhook_event, event);
  assert.equal(payload.transmission_id, 'transmission-1');
});

test('PayPal can read an existing webhook event through the Sandbox API without resending it', async () => {
  const calls = [];
  const event = { id: 'WH-COC11055RA711503B-4YM959094A144403T', event_type: 'CHECKOUT.ORDER.APPROVED', create_time: '2026-11-11T10:00:00Z', summary: 'Test event' };
  const paypal = createPayPal({
    clientId: 'sandbox-client', secret: 'sandbox-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/v1/oauth2/token')) return response(200, { access_token: 'sandbox-access-token', expires_in: 3600 });
      return response(200, event);
    },
  });
  const result = await paypal.getWebhookEvent(event.id);
  assert.deepEqual(result, event);
  assert.equal(calls[1].url, 'https://api-m.sandbox.paypal.com/v1/notifications/webhooks-events/' + event.id);
  assert.equal(calls[1].options.method, 'GET');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer sandbox-access-token');
  await assert.rejects(paypal.getWebhookEvent('../bad'), /Invalid PayPal webhook event ID/);
});

test('PayPal can list recent Sandbox webhook events with date filters', async () => {
  const calls = [];
  const paypal = createPayPal({
    clientId: 'sandbox-client', secret: 'sandbox-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/v1/oauth2/token')) return response(200, { access_token: 'sandbox-access-token', expires_in: 3600 });
      return response(200, { count: 1, events: [{ id: 'WH-123', event_type: 'CHECKOUT.ORDER.APPROVED' }] });
    },
  });
  const result = await paypal.listWebhookEvents({ startTime: '2026-11-01T00:00:00Z', endTime: '2026-11-12T23:59:59Z', pageSize: 100 });
  assert.equal(result.count, 1);
  assert.match(calls[1].url, /\/v1\/notifications\/webhooks-events\?/);
  assert.match(calls[1].url, /start_time=2026-11-01T00%3A00%3A00Z/);
  assert.match(calls[1].url, /page_size=100/);
  assert.equal(calls[1].options.method, 'GET');
});

test('PayPal webhook verifier returns false when required verification inputs are missing', async () => {
  let called = false;
  const paypal = createPayPal({
    clientId: 'sandbox-client', secret: 'sandbox-secret',
    fetchImpl: async () => { called = true; throw new Error('must not call API'); },
  });
  assert.equal(await paypal.verifyWebhookSignature({ webhookId: 'webhook-id' }), false);
  assert.equal(called, false);
});

test('PayPal webhook verifier rejects non-success verification responses', async () => {
  const fetchImpl = async (url) => url.endsWith('/v1/oauth2/token')
    ? response(200, { access_token: 'sandbox-access-token', expires_in: 3600 })
    : response(200, { verification_status: 'FAILURE' });
  const paypal = createPayPal({ clientId: 'sandbox-client', secret: 'sandbox-secret', fetchImpl });
  const verified = await paypal.verifyWebhookSignature({
    authAlgo: 'SHA256withRSA', certUrl: 'https://api-m.sandbox.paypal.com/cert/test',
    transmissionId: 'transmission-1', transmissionSig: 'signature-value',
    transmissionTime: '2026-10-27T12:00:00Z', webhookId: 'webhook-id',
    webhookEvent: { id: 'WH-1', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'ORDER-1' } },
  });
  assert.equal(verified, false);
});

test('PayPal timeout/network errors are converted to safe, classified errors', async () => {
  const paypal = createPayPal({
    clientId: 'sandbox-client', secret: 'sandbox-secret',
    fetchImpl: async () => { const e = new Error('aborted'); e.name = 'TimeoutError'; throw e; },
  });
  await assert.rejects(paypal.getOrder('ORDER-123'), (e) => e.code === 'PAYPAL_TIMEOUT' && !e.message.includes('sandbox-secret'));
});

test('PayPal rejects oversized responses before parsing them', async () => {
  const paypal = createPayPal({
    clientId: 'sandbox-client', secret: 'sandbox-secret', maxResponseBytes: 1024,
    fetchImpl: async () => response(200, '{}', '9999999'),
  });
  await assert.rejects(paypal.getOrder('ORDER-123'), (e) => e.code === 'PAYPAL_RESPONSE_TOO_LARGE');
});

test('PayPal cancels a streaming response when it exceeds the configured size limit', async () => {
  let cancelled = false;
  const paypal = createPayPal({
    clientId: 'sandbox-client', secret: 'sandbox-secret', maxResponseBytes: 1024,
    fetchImpl: async () => ({
      status: 200,
      headers: { get() { return null; } },
      body: {
        getReader() {
          let sent = false;
          return {
            async read() {
              if (sent) return { done: true };
              sent = true;
              return { done: false, value: new Uint8Array(2048) };
            },
            async cancel() { cancelled = true; },
          };
        },
      },
    }),
  });
  await assert.rejects(paypal.getOrder('ORDER-123'), (e) => e.code === 'PAYPAL_RESPONSE_TOO_LARGE');
  assert.equal(cancelled, true);
});

test('PayPal rejects malformed JSON rather than trusting an invalid response', async () => {
  const paypal = createPayPal({
    clientId: 'sandbox-client', secret: 'sandbox-secret',
    fetchImpl: async () => response(200, '{not-json'),
  });
  await assert.rejects(paypal.getOrder('ORDER-123'), /invalid response/i);
});

test('PayPal order approval link must use an exact trusted Sandbox hostname', async () => {
  let calls = 0;
  const paypal = createPayPal({
    clientId: 'sandbox-client', secret: 'sandbox-secret',
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return response(200, { access_token: 'sandbox-token', expires_in: 300 });
      return response(201, { id: 'ORDER-123', links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-123' }] });
    },
  });
  const order = await paypal.createOrder({
    invoice: { id: 'inv1', number: 'INV-1', amount: 10, currency: 'USD' },
    requestId: 'req-1', returnUrl: 'https://example.test/return', cancelUrl: 'https://example.test/cancel',
  });
  assert.equal(new URL(order.approveUrl).hostname, 'www.sandbox.paypal.com');
});

test('PayPal rejects HTTPS approval links hosted by an untrusted domain', async () => {
  let calls = 0;
  const paypal = createPayPal({
    clientId: 'sandbox-client', secret: 'sandbox-secret',
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return response(200, { access_token: 'sandbox-token', expires_in: 300 });
      return response(201, { id: 'ORDER-123', links: [{ rel: 'approve', href: 'https://paypal.com.attacker.example/checkout' }] });
    },
  });
  await assert.rejects(paypal.createOrder({
    invoice: { id: 'inv1', number: 'INV-1', amount: 10, currency: 'USD' },
    requestId: 'req-1', returnUrl: 'https://example.test/return', cancelUrl: 'https://example.test/cancel',
  }), /trusted Sandbox approval link/i);
});
