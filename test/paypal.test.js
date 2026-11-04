'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPayPal } = require('../lib/paypal');

test('PayPal webhook verifier sends the event and transmission headers to the official verification API', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/v1/oauth2/token')) {
      return { status: 200, json: async () => ({ access_token: 'sandbox-access-token', expires_in: 3600 }) };
    }
    return { status: 200, json: async () => ({ verification_status: 'SUCCESS' }) };
  };
  const paypal = createPayPal({ clientId: 'sandbox-client', secret: 'sandbox-secret', fetchImpl });
  const event = { id: 'WH-1', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'ORDER-1' } };
  const verified = await paypal.verifyWebhookSignature({
    authAlgo: 'SHA256withRSA',
    certUrl: 'https://api-m.sandbox.paypal.com/cert/test',
    transmissionId: 'transmission-1',
    transmissionSig: 'signature-value',
    transmissionTime: '2026-10-27T12:00:00Z',
    webhookId: 'webhook-id',
    webhookEvent: event,
  });
  assert.equal(verified, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer sandbox-access-token');
  const payload = JSON.parse(calls[1].options.body);
  assert.equal(payload.webhook_id, 'webhook-id');
  assert.deepEqual(payload.webhook_event, event);
  assert.equal(payload.transmission_id, 'transmission-1');
});

test('PayPal webhook verifier returns false when required verification inputs are missing', async () => {
  let called = false;
  const paypal = createPayPal({
    clientId: 'sandbox-client',
    secret: 'sandbox-secret',
    fetchImpl: async () => { called = true; throw new Error('must not call API'); },
  });
  assert.equal(await paypal.verifyWebhookSignature({ webhookId: 'webhook-id' }), false);
  assert.equal(called, false);
});

test('PayPal webhook verifier rejects non-success verification responses', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/v1/oauth2/token')) return { status: 200, json: async () => ({ access_token: 'sandbox-access-token', expires_in: 3600 }) };
    return { status: 200, json: async () => ({ verification_status: 'FAILURE' }) };
  };
  const paypal = createPayPal({ clientId: 'sandbox-client', secret: 'sandbox-secret', fetchImpl });
  const verified = await paypal.verifyWebhookSignature({
    authAlgo: 'SHA256withRSA',
    certUrl: 'https://api-m.sandbox.paypal.com/cert/test',
    transmissionId: 'transmission-1',
    transmissionSig: 'signature-value',
    transmissionTime: '2026-10-27T12:00:00Z',
    webhookId: 'webhook-id',
    webhookEvent: { id: 'WH-1', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'ORDER-1' } },
  });
  assert.equal(verified, false);
});
