'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const { createStore } = require('../lib/store');

async function boot() {
  const app = createApp({
    env: {
      NODE_ENV: 'production',
      APP_BASE_URL: 'https://paypilot-ai-pg-staging.onrender.com',
      ENABLE_PUBLIC_DEMO_MUTATIONS: 'false',
    },
    store: createStore(null),
    paypal: { configured: () => false },
  });
  await new Promise((resolve) => app.server.listen(0, resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const call = async (method, path, body) => {
    const response = await fetch(base + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await response.json(); } catch (_) {}
    return { status: response.status, json };
  };
  return { app, call, close: () => app.server.close() };
}

test('public shared judge demo rejects state-changing actions while health and trust remain readable', async () => {
  const t = await boot();
  try {
    const health = await t.call('GET', '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.demo.publicMutationsEnabled, false);
    const trust = await t.call('GET', '/api/trust');
    assert.equal(trust.status, 200);
    assert.equal(trust.json.controls.publicDemoMutations, false);
    const mutation = await t.call('POST', '/api/assistant/chat', { message: 'draft a reminder' });
    assert.equal(mutation.status, 403);
    assert.match(mutation.json.error, /read-only/i);
  } finally { t.close(); }
});
