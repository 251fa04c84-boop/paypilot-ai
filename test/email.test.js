'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createResendEmailProvider, createBrevoEmailProvider } = require('../lib/email');

test('Resend adapter sends reset email with a one-time HTTPS link', async () => {
  let request;
  const provider = createResendEmailProvider({
    apiKey: 're_test_key',
    from: 'accounts@example.com',
    appBaseUrl: 'https://paypilot.example.com',
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return { ok: true, status: 200 };
    }
  });
  assert.equal(provider.configured, true);
  await provider.sendPasswordReset({ to: 'owner@example.com', token: 'a'.repeat(43) });
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.options.headers.Authorization, 'Bearer re_test_key');
  assert.deepEqual(request.body.to, ['owner@example.com']);
  assert.match(request.body.text, /https:\/\/paypilot\.example\.com\/\?reset_token=/);
  assert.equal(request.body.html.includes('a'.repeat(43)), true);
});

test('Resend adapter rejects unverified configuration and invalid recipients/tokens', async () => {
  const disabled = createResendEmailProvider({ apiKey: 'key', from: 'accounts@example.com', appBaseUrl: 'http://localhost' });
  assert.equal(disabled.configured, false);
  await assert.rejects(() => disabled.sendPasswordReset({ to: 'owner@example.com', token: 'a'.repeat(43) }), /not configured/);

  const enabled = createResendEmailProvider({ apiKey: 'key', from: 'accounts@example.com', appBaseUrl: 'https://paypilot.example.com', fetchImpl: async () => ({ ok: true }) });
  await assert.rejects(() => enabled.sendPasswordReset({ to: 'not-an-email', token: 'a'.repeat(43) }), /recipient/);
  await assert.rejects(() => enabled.sendPasswordReset({ to: 'owner@example.com', token: 'bad' }), /token/);
});

test('Resend provider errors are surfaced to the route for token invalidation', async () => {
  const provider = createResendEmailProvider({
    apiKey: 'key',
    from: 'accounts@example.com',
    appBaseUrl: 'https://paypilot.example.com',
    fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'domain not verified' })
  });
  await assert.rejects(() => provider.sendPasswordReset({ to: 'owner@example.com', token: 'a'.repeat(43) }), /403/);
});


test('Brevo adapter sends reset email through the transactional API', async () => {
  let request;
  const provider = createBrevoEmailProvider({
    apiKey: 'xkeysib-test-key',
    from: 'PayPilot Accounts <accounts@example.com>',
    appBaseUrl: 'https://paypilot.example.com',
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return { ok: true, status: 201 };
    }
  });
  assert.equal(provider.configured, true);
  assert.equal(provider.provider, 'Brevo');
  await provider.sendPasswordReset({ to: 'owner@example.com', token: 'b'.repeat(43) });
  assert.equal(request.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(request.options.headers['api-key'], 'xkeysib-test-key');
  assert.equal(request.options.headers.Authorization, undefined);
  assert.deepEqual(request.body.to, [{ email: 'owner@example.com' }]);
  assert.equal(request.body.sender.email, 'accounts@example.com');
  assert.match(request.body.textContent, /https:\/\/paypilot\.example\.com\/\?reset_token=/);
});

test('Brevo adapter rejects provider failures', async () => {
  const provider = createBrevoEmailProvider({
    apiKey: 'xkeysib-test-key',
    from: 'accounts@example.com',
    appBaseUrl: 'https://paypilot.example.com',
    fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'invalid API key' })
  });
  await assert.rejects(() => provider.sendPasswordReset({ to: 'owner@example.com', token: 'c'.repeat(43) }), /401/);
});
