'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../lib/store');
const { createApp } = require('../server');

function fakePayPal(script = {}) {
  let n = 0; const calls = { create: 0, capture: 0 };
  return {
    calls, configured: () => script.configured !== false,
    createOrder: async ({ invoice }) => { calls.create++; const id = `ORDER${++n}`; return { id, approveUrl: `https://sandbox.paypal.test/approve/${id}`, invoice }; },
    captureOrder: async (id) => {
      calls.capture++;
      if (script.notApproved) { const e = new Error('The buyer has not approved this order in PayPal yet.'); e.code = 'NOT_APPROVED'; throw e; }
      const inv = script.invoice();
      return { status: 'COMPLETED', purchase_units: [{ reference_id: inv.id, payments: { captures: [Object.assign({ id: 'CAP-' + id, status: 'COMPLETED', amount: { value: inv.amount.toFixed(2), currency_code: inv.currency } }, script.cap || {})] } }] };
    },
  };
}

async function boot({ paypal, aiFetch, env = {}, limits } = {}) {
  const app = createApp({ env: Object.assign({ APP_BASE_URL: 'http://test.local' }, env), store: createStore(null), paypal: paypal || fakePayPal({ invoice: () => app.db.invoices[0] }), aiFetch, limits, now: () => new Date('2026-03-10T12:00:00Z') });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, path, body, extraHeaders = {}) => {
    const res = await fetch(base + path, { method, redirect: 'manual', headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, extraHeaders), body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await res.json(); } catch (_) {}
    return { status: res.status, json, headers: res.headers };
  };
  return { app, call, close: () => app.server.close() };
}
const NEW = { client: 'Acme', number: 'INV-1', amount: 120.5, currency: 'USD', issueDate: '2026-01-01', dueDate: '2026-02-20' };

test('production public demo mutations are read-only unless explicitly enabled; verified PayPal endpoints remain reachable', async () => {
  let t = await boot({ env: { NODE_ENV: 'production' } });
  try {
    t.app.seedDemo();
    const health = await t.call('GET', '/api/health');
    assert.equal(health.json.demo.publicMutationsEnabled, false);
    assert.equal((await t.call('GET', '/api/invoices')).status, 200);
    assert.equal((await t.call('POST', '/api/assistant/chat', { query: 'summarize overdue invoices' })).status, 403);
    assert.equal((await t.call('POST', '/api/demo/seed', {})).status, 403);
    assert.equal((await t.call('POST', '/api/paypal/capture', { orderId: 'UNKNOWN1' })).status, 404);
  } finally { t.close(); }

  t = await boot({ env: { NODE_ENV: 'production', ENABLE_PUBLIC_DEMO_MUTATIONS: 'true' } });
  try {
    const health = await t.call('GET', '/api/health');
    assert.equal(health.json.demo.publicMutationsEnabled, true);
    assert.equal((await t.call('POST', '/api/demo/seed', {})).status, 201);
    assert.equal((await t.call('GET', '/api/invoices')).json.length, 8);
  } finally { t.close(); }
});

test('invoice CRUD with validation', async () => {
  const t = await boot();
  try {
    assert.equal((await t.call('POST', '/api/invoices', { client: '' })).status, 400);
    const c = await t.call('POST', '/api/invoices', NEW); assert.equal(c.status, 201);
    assert.equal(c.json.assessment.overdueDays, 18);
    const id = c.json.id;
    assert.equal((await t.call('PUT', `/api/invoices/${id}`, { dueDate: '2025-01-01' })).status, 400);
    assert.equal((await t.call('PUT', `/api/invoices/${id}`, { notes: 'hello' })).json.notes, 'hello');
    assert.equal((await t.call('DELETE', `/api/invoices/${id}`)).status, 200);
    assert.equal((await t.call('GET', `/api/invoices/${id}`)).status, 404);
  } finally { t.close(); }
});

test('draft -> edit -> approve -> mark sent keeps an honest audit trail', async () => {
  const t = await boot();
  try {
    const id = (await t.call('POST', '/api/invoices', NEW)).json.id;
    const d = (await t.call('POST', `/api/invoices/${id}/drafts`, {})).json;
    assert.match(d.source, /template \(no AI key configured\)/); assert.equal(d.tone, 'firm');
    assert.equal((await t.call('POST', `/api/drafts/${d.id}/sent`)).status, 409); // cannot send before approval
    assert.equal((await t.call('PUT', `/api/drafts/${d.id}`, { text: 'Hi, pay at {{PAYMENT_LINK}}' })).status, 200);
    const ap = (await t.call('POST', `/api/drafts/${d.id}/approve`)).json;
    assert.equal(ap.status, 'approved'); assert.ok(ap.text.includes(`http://test.local/pay/${id}`));
    assert.equal((await t.call('PUT', `/api/drafts/${d.id}`, { text: 'changed' })).status, 409); // locked after approval
    const sent = (await t.call('POST', `/api/drafts/${d.id}/sent`)).json;
    assert.equal(sent.invoice.reminderCount, 1);
    const types = (await t.call('GET', `/api/invoices/${id}`)).json.actions.map((a) => a.type).reverse();
    assert.deepEqual(types, ['invoice_created', 'draft_generated', 'draft_edited', 'draft_approved', 'reminder_sent_by_user']);
    // right after sending, the app advises waiting
    assert.equal((await t.call('GET', `/api/invoices/${id}`)).json.assessment.action, 'wait_recent_reminder');
  } finally { t.close(); }
});

test('AI draft uses Gemini when key is set, and falls back honestly on failure', async () => {
  let seen = null;
  const ok = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Hi Acme, a quick reminder that invoice INV-1 for 120.50 USD is overdue. You can pay here: {{PAYMENT_LINK}} Thank you.' }] } }] }) }; };
  let t = await boot({ env: { GEMINI_API_KEY: 'k' }, aiFetch: ok });
  try {
    const id = (await t.call('POST', '/api/invoices', NEW)).json.id;
    const d = (await t.call('POST', `/api/invoices/${id}/drafts`, {})).json;
    assert.match(d.source, /^AI: Google Gemini/); assert.match(d.text, /invoice INV-1 for 120.50 USD/);
    assert.ok(seen.url.includes('generativelanguage.googleapis.com')); assert.ok(!seen.url.includes('k=')); // key travels in a header, not the URL
    assert.ok(JSON.parse(seen.init.body).contents[0].parts[0].text.includes('INV-1'));
  } finally { t.close(); }
  t = await boot({ env: { GEMINI_API_KEY: 'k' }, aiFetch: async () => ({ ok: false, status: 429 }) });
  try {
    const id = (await t.call('POST', '/api/invoices', NEW)).json.id;
    const d = (await t.call('POST', `/api/invoices/${id}/drafts`, {})).json;
    assert.match(d.source, /template \(AI request failed: HTTP 429 \(tried 2 models\)\)/);
  } finally { t.close(); }
});

test('no draft when the advice is to wait, unless forced', async () => {
  const t = await boot();
  try {
    const id = (await t.call('POST', '/api/invoices', Object.assign({}, NEW, { dueDate: '2026-12-01' }))).json.id;
    const r = await t.call('POST', `/api/invoices/${id}/drafts`, {}); assert.equal(r.status, 409); assert.equal(r.json.canForce, true);
    assert.equal((await t.call('POST', `/api/invoices/${id}/drafts`, { force: true })).status, 201);
  } finally { t.close(); }
});

test('invoice amount and currency cannot change while a PayPal checkout is pending', async () => {
  const t = await boot();
  try {
    const id = (await t.call('POST', '/api/invoices', NEW)).json.id;
    const checkout = await t.call('POST', `/api/invoices/${id}/pay`);
    assert.equal(checkout.status, 200);
    const amountEdit = await t.call('PUT', `/api/invoices/${id}`, { amount: 999 });
    assert.equal(amountEdit.status, 409);
    assert.match(amountEdit.json.error, /open PayPal Sandbox checkout/i);
    const currencyEdit = await t.call('PUT', `/api/invoices/${id}`, { currency: 'EUR' });
    assert.equal(currencyEdit.status, 409);
    const unchanged = await t.call('GET', `/api/invoices/${id}`);
    assert.equal(unchanged.json.amount, NEW.amount);
    assert.equal(unchanged.json.currency, NEW.currency);
  } finally { t.close(); }
});

test('PayPal: success path verifies server-side, and repeated capture does not capture twice', async () => {
  const t = await boot();
  try {
    const id = (await t.call('POST', '/api/invoices', NEW)).json.id;
    const pay = await t.call('POST', `/api/invoices/${id}/pay`); assert.equal(pay.status, 200);
    assert.match(pay.json.approveUrl, /sandbox\.paypal\.test/);
    assert.equal((await t.call('GET', `/api/invoices/${id}`)).json.status, 'open'); // creating a link never marks paid
    const orderId = t.app.db.orders[0].orderId;
    const [c1, c2] = await Promise.all([t.call('POST', '/api/paypal/capture', { orderId }), t.call('POST', '/api/paypal/capture', { orderId })]);
    assert.ok([c1.status, c2.status].every((x) => x === 200 || x === 409)); // a racing duplicate is either refused or answered as already-recorded
    assert.ok(c1.status === 200 || c2.status === 200);
    const c3 = await t.call('POST', '/api/paypal/capture', { orderId });
    assert.equal(c3.json.outcome, 'paid');
    assert.equal(t.app.db.invoices[0].status, 'paid'); assert.equal(t.app.db.invoices[0].paymentMethod, 'paypal_sandbox');
    assert.equal(t.app.db.orders[0].status, 'captured');
    assert.equal((await t.call('POST', `/api/invoices/${id}/pay`)).status, 409); // paid invoices cannot be paid again
    assert.equal((await t.call('DELETE', `/api/invoices/${id}`)).status, 409);
  } finally { t.close(); }
});

test('PayPal: capture calls PayPal exactly once even when asked repeatedly', async () => {
  const pp = fakePayPal({ invoice: () => null });
  const t = await boot({ paypal: Object.assign(pp, { captureOrder: async (id) => { pp.calls.capture++; const inv = t.app.db.invoices[0]; return { status: 'COMPLETED', purchase_units: [{ reference_id: inv.id, payments: { captures: [{ id: 'C', status: 'COMPLETED', amount: { value: inv.amount.toFixed(2), currency_code: inv.currency } }] } }] }; } }) });
  try {
    const id = (await t.call('POST', '/api/invoices', NEW)).json.id; await t.call('POST', `/api/invoices/${id}/pay`);
    const orderId = t.app.db.orders[0].orderId;
    await t.call('POST', '/api/paypal/capture', { orderId }); await t.call('POST', '/api/paypal/capture', { orderId }); await t.call('POST', '/api/paypal/capture', { orderId });
    assert.equal(pp.calls.capture, 1);
  } finally { t.close(); }
});

test('PayPal: not approved, unknown order, tampered amount, pending, cancel', async () => {
  let t = await boot({ paypal: fakePayPal({ notApproved: true }) });
  try {
    const id = (await t.call('POST', '/api/invoices', NEW)).json.id; await t.call('POST', `/api/invoices/${id}/pay`);
    const r = await t.call('POST', '/api/paypal/capture', { orderId: t.app.db.orders[0].orderId });
    assert.equal(r.status, 409); assert.equal(t.app.db.invoices[0].status, 'open');
    assert.equal(t.app.db.orders[0].status, 'created'); // can retry after the buyer approves
    assert.equal((await t.call('POST', '/api/paypal/capture', { orderId: 'FAKE-ORDER-ID' })).status, 404); // never trust ids we did not create
    assert.equal((await t.call('POST', '/api/paypal/capture', { orderId: '../../etc' })).status, 400);
    const auditBeforeCancel = t.app.db.actions.length;
    const cancel = await t.call('GET', `/paypal/cancel?token=${t.app.db.orders[0].orderId}`);
    assert.equal(cancel.status, 302);
    // A cross-site browser GET must not mutate payment or approval state.
    assert.equal(t.app.db.orders[0].status, 'created');
    assert.equal(t.app.db.invoices[0].status, 'open');
    assert.equal(t.app.db.actions.length, auditBeforeCancel);
    // Capture still requires a server-side PayPal result; this fake buyer has not approved.
    assert.equal((await t.call('POST', '/api/paypal/capture', { orderId: t.app.db.orders[0].orderId })).status, 409);
  } finally { t.close(); }
  t = await boot({ paypal: fakePayPal({ invoice: () => ({ id: t0(), amount: 1, currency: 'USD' }) }) });
  function t0() { return t.app.db.invoices[0].id; }
  try { // PayPal says 1.00 was captured but invoice is 120.50
    const id = (await t.call('POST', '/api/invoices', NEW)).json.id; await t.call('POST', `/api/invoices/${id}/pay`);
    const r = await t.call('POST', '/api/paypal/capture', { orderId: t.app.db.orders[0].orderId });
    assert.equal(r.json.outcome, 'failed'); assert.equal(t.app.db.invoices[0].status, 'open');
  } finally { t.close(); }
  t = await boot({ paypal: fakePayPal({ invoice: () => t.app.db.invoices[0], cap: { status: 'PENDING' } }) });
  try {
    const id = (await t.call('POST', '/api/invoices', NEW)).json.id; await t.call('POST', `/api/invoices/${id}/pay`);
    const r = await t.call('POST', '/api/paypal/capture', { orderId: t.app.db.orders[0].orderId });
    assert.equal(r.json.outcome, 'pending'); assert.equal(t.app.db.invoices[0].status, 'open');
  } finally { t.close(); }
});

test('PayPal not configured: honest 503, health says so, payment-link GET stays side-effect free', async () => {
  const t = await boot({ paypal: fakePayPal({ configured: false }) });
  try {
    const id = (await t.call('POST', '/api/invoices', NEW)).json.id;
    assert.equal((await t.call('POST', `/api/invoices/${id}/pay`)).status, 503);
    assert.equal((await t.call('GET', '/api/health')).json.paypal.configured, false);
    const page = await fetch(`http://127.0.0.1:${t.app.server.address().port}/pay/${id}`);
    assert.equal(page.status, 503);
    assert.match(await page.text(), /PayPal Sandbox is not configured/);
    const checkout = await t.call('POST', `/pay/${id}/checkout`);
    assert.equal(checkout.status, 503);
  } finally { t.close(); }
});

test('payment-link GET never creates a PayPal order; explicit POST does', async () => {
  const paypal = fakePayPal();
  const t = await boot({ paypal });
  try {
    const id = (await t.call('POST', '/api/invoices', NEW)).json.id;
    const page = await fetch(`http://127.0.0.1:${t.app.server.address().port}/pay/${id}`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), new RegExp(`action="/pay/${id}/checkout"`));
    assert.equal(paypal.calls.create, 0);
    const checkout = await t.call('POST', `/pay/${id}/checkout`);
    assert.equal(checkout.status, 302);
    assert.ok(checkout.headers.get('location').includes('sandbox.paypal.test'));
    assert.equal(paypal.calls.create, 1);
  } finally { t.close(); }
});

test('production read-only mode blocks payment-link POST while allowing harmless GET', async () => {
  const paypal = fakePayPal();
  const t = await boot({ paypal, env: { NODE_ENV: 'production' } });
  try {
    t.app.seedDemo();
    const invoice = t.app.db.invoices.find((i) => i.status === 'open' && !i.disputed);
    const page = await fetch(`http://127.0.0.1:${t.app.server.address().port}/pay/${invoice.id}`);
    assert.equal(page.status, 403);
    assert.match(await page.text(), /Interactive checkout is disabled/);
    assert.equal((await t.call('POST', `/pay/${invoice.id}/checkout`)).status, 403);
    assert.equal(paypal.calls.create, 0);
  } finally { t.close(); }
});

test('GET proposal views show expiry without mutating the database or audit trail', async () => {
  const t = await boot();
  try {
    const invoice = (await t.call('POST', '/api/invoices', NEW)).json;
    const proposal = (await t.call('POST', `/api/invoices/${invoice.id}/proposals`, { action: 'send_reminder' })).json;
    const stored = t.app.db.proposals.find((p) => p.id === proposal.id);
    stored.expiresAt = '2020-01-01T00:00:00.000Z';
    const beforeActions = t.app.db.actions.length;
    const detail = await t.call('GET', `/api/invoices/${invoice.id}`);
    assert.equal(detail.json.proposals[0].status, 'expired');
    const list = await t.call('GET', '/api/proposals');
    assert.equal(list.json.find((p) => p.id === proposal.id).status, 'expired');
    assert.equal(stored.status, 'pending');
    assert.equal(t.app.db.actions.length, beforeActions);
    assert.equal((await t.call('POST', `/api/proposals/${proposal.id}/decision`, { decision: 'approve' })).status, 409);
    assert.equal(stored.status, 'expired');
    assert.equal(t.app.db.actions.length, beforeActions + 1);
  } finally { t.close(); }
});

test('demo data is labelled and removable; manual paid is recorded as manual', async () => {
  const t = await boot();
  try {
    assert.equal((await t.call('POST', '/api/demo/seed')).status, 201);
    assert.equal((await t.call('POST', '/api/demo/seed')).status, 409);
    const list = (await t.call('GET', '/api/invoices')).json;
    assert.equal(list.length, 8); assert.ok(list.every((i) => i.demo && /demo/.test(i.client)));
    const q = (await t.call('GET', '/api/recovery')).json;
    assert.ok(q.length >= 3); assert.ok(q[0].assessment.score >= q[q.length - 1].assessment.score);
    const m = await t.call('POST', `/api/invoices/${list[0].id}/mark-paid-manually`); assert.equal(m.json.paymentMethod, 'manual');
    assert.equal((await t.call('DELETE', '/api/demo')).json.removed, 8);
    assert.equal((await t.call('GET', '/api/invoices')).json.length, 0);
  } finally { t.close(); }
});

test('audit CSV neutralizes spreadsheet formula prefixes in user-controlled fields', async () => {
  const t = await boot();
  try {
    const malicious = Object.assign({}, NEW, {
      client: '=HYPERLINK("https://attacker.example","open")',
      number: '+SUM(1,1)',
    });
    const created = await t.call('POST', '/api/invoices', malicious);
    assert.equal(created.status, 201);
    const exported = await t.call('GET', '/api/actions/export?format=csv');
    assert.equal(exported.status, 200);
    assert.ok(exported.json === null);
    const response = await fetch(`http://127.0.0.1:${t.app.server.address().port}/api/actions/export?format=csv`);
    const csv = await response.text();
    assert.ok(csv.includes("'=HYPERLINK"));
    assert.ok(csv.includes("'+SUM(1"));
  } finally { t.close(); }
});

test('static files are served safely with security headers', async () => {
  const t = await boot();
  try {
    const base = `http://127.0.0.1:${t.app.server.address().port}`;
    const idx = await fetch(base + '/'); assert.equal(idx.status, 200);
    assert.ok(idx.headers.get('content-security-policy').includes("default-src 'self'"));
    assert.equal(idx.headers.get('x-frame-options'), 'DENY');
    assert.equal(idx.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
    const api = await fetch(base + '/api/invoices');
    assert.equal(api.headers.get('cache-control'), 'no-store');
    assert.equal(api.headers.get('pragma'), 'no-cache');
    assert.equal((await fetch(base + '/../server.js')).status, 404);
    assert.equal((await fetch(base + '/%2e%2e/server.js')).status, 404);
    assert.equal((await fetch(base + '/data/db.json')).status, 404);
  } finally { t.close(); }
});


test('state-changing API requests reject cross-site browser origins', async () => {
  const t = await boot();
  try {
    const hostile = await t.call('POST', '/api/demo/simulate', { ai: true }, { Origin: 'https://attacker.example' });
    assert.equal(hostile.status, 403);
    assert.match(hostile.json.error, /origin/i);

    const crossSite = await t.call('POST', '/api/demo/simulate', { ai: true }, { 'Sec-Fetch-Site': 'cross-site' });
    assert.equal(crossSite.status, 403);

    const sameOrigin = await t.call('POST', '/api/demo/simulate', { ai: false }, { Origin: 'http://127.0.0.1:' + t.app.server.address().port });
    assert.equal(sameOrigin.status, 200);
    assert.equal(sameOrigin.json.simulateAi, false);
  } finally { t.close(); }
});


test('public production mode blocks shared demo reset and global outage toggles', async () => {
  const t = await boot({ env: { NODE_ENV: 'production', ENABLE_PUBLIC_DEMO_MUTATIONS: 'true' } });
  try {
    const health = await t.call('GET', '/api/health');
    assert.equal(health.json.demo.adminControlsEnabled, false);
    assert.equal((await t.call('POST', '/api/demo/seed')).status, 201);
    assert.equal((await t.call('DELETE', '/api/demo')).status, 403);
    assert.equal((await t.call('POST', '/api/demo/simulate', { paypal: true })).status, 403);
    assert.equal((await t.call('GET', '/api/invoices')).json.length, 8);
  } finally { t.close(); }
});


test('PayPal webhook requires a valid signature and deduplicates verified events', async () => {
  let t;
  let verificationCalls = 0;
  const pp = fakePayPal({ invoice: () => t.app.db.invoices[0] });
  pp.verifyWebhookSignature = async (signature) => {
    verificationCalls++;
    assert.equal(signature.webhookId, 'WH-TEST-123');
    return signature.transmissionSig === 'valid-signature';
  };
  t = await boot({ paypal: pp, env: { PAYPAL_WEBHOOK_ID: 'WH-TEST-123' } });
  const headers = {
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api.sandbox.paypal.com/certs/test',
    'paypal-transmission-id': 'transmission-1',
    'paypal-transmission-sig': 'valid-signature',
    'paypal-transmission-time': '2026-03-10T12:00:00Z',
  };
  try {
    const id = (await t.call('POST', '/api/invoices', NEW)).json.id;
    await t.call('POST', `/api/invoices/${id}/pay`);
    const orderId = t.app.db.orders[0].orderId;
    const event = { id: 'EVT-ONE', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: orderId } };

    const missingHeaders = await t.call('POST', '/api/paypal/webhook', event);
    assert.equal(missingHeaders.status, 401);
    assert.equal(verificationCalls, 0);
    assert.equal(t.app.db.invoices[0].status, 'open');

    const invalid = await t.call('POST', '/api/paypal/webhook', event, Object.assign({}, headers, {
      'paypal-transmission-sig': 'invalid-signature',
    }));
    assert.equal(invalid.status, 401);
    assert.equal(t.app.db.invoices[0].status, 'open');

    const accepted = await t.call('POST', '/api/paypal/webhook', event, headers);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.json.verified, true);
    assert.equal(accepted.json.captureResult.outcome, 'paid');
    assert.equal(t.app.db.invoices[0].status, 'paid');
    assert.equal(pp.calls.capture, 1);

    const duplicate = await t.call('POST', '/api/paypal/webhook', event, headers);
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.json.duplicate, true);
    assert.equal(pp.calls.capture, 1);
    assert.equal(t.app.db.processedWebhookEvents.filter((x) => x.id === 'EVT-ONE').length, 1);
  } finally { t.close(); }
});


test('public production mode blocks simulated payment settlement', async () => {
  const t = await boot({ env: { NODE_ENV: 'production', ENABLE_PUBLIC_DEMO_MUTATIONS: 'true' } });
  try {
    assert.equal((await t.call('POST', '/api/demo/seed')).status, 201);
    const invoice = (await t.call('GET', '/api/invoices')).json.find((i) => i.demo && i.status === 'open');
    assert.ok(invoice);
    assert.equal((await t.call('POST', `/api/invoices/${invoice.id}/pay`)).status, 200);
    const orderId = t.app.db.orders[0].orderId;
    const simulated = await t.call('POST', '/api/demo/simulate-webhook', { orderId });
    assert.equal(simulated.status, 403);
    assert.equal(t.app.db.invoices.find((i) => i.id === invoice.id).status, 'open');
    assert.equal(t.app.db.orders[0].status, 'created');
  } finally { t.close(); }
});

test('ENABLE_DEMO_ADMIN cannot enable simulated settlement in production', async () => {
  const t = await boot({ env: { NODE_ENV: 'production', ENABLE_DEMO_ADMIN: 'true', ENABLE_PUBLIC_DEMO_MUTATIONS: 'true' } });
  try {
    const health = await t.call('GET', '/api/health');
    assert.equal(health.json.demo.adminControlsEnabled, false);
    assert.equal((await t.call('POST', '/api/demo/simulate-webhook', { orderId: 'ORDER12345' })).status, 403);
    assert.equal((await t.call('DELETE', '/api/demo')).status, 403);
  } finally { t.close(); }
});


test('oversized JSON bodies receive a controlled 413 response without destroying the connection', async () => {
  const t = await boot();
  try {
    const response = await t.call('POST', '/api/invoices', Object.assign({}, NEW, { notes: 'x'.repeat(110000) }));
    assert.equal(response.status, 413);
    assert.match(response.json.error, /too large/i);
    assert.equal((await t.call('GET', '/api/invoices')).json.length, 0);
  } finally { t.close(); }
});


test('Render production marker activates public demo restrictions without NODE_ENV', async () => {
  const t = await boot({ env: { RENDER: 'true' } });
  try {
    const health = await t.call('GET', '/api/health');
    assert.equal(health.json.demo.adminControlsEnabled, false);
    assert.equal((await t.call('POST', '/api/invoices', NEW)).status, 403);
    assert.equal((await t.call('POST', '/api/demo/simulate', { ai: true })).status, 403);
  } finally { t.close(); }
});

test('public production demo blocks invoice creation and destructive/manual record edits', async () => {
  const t = await boot({ env: { NODE_ENV: 'production', ENABLE_PUBLIC_DEMO_MUTATIONS: 'true' } });
  try {
    assert.equal((await t.call('POST', '/api/demo/seed')).status, 201);
    const invoices = (await t.call('GET', '/api/invoices')).json;
    const invoice = invoices.find((i) => i.demo && i.status === 'open');
    assert.ok(invoice);
    assert.equal((await t.call('POST', '/api/invoices', NEW)).status, 403);
    assert.equal((await t.call('PUT', '/api/invoices/' + invoice.id, { notes: 'tampered' })).status, 403);
    assert.equal((await t.call('DELETE', '/api/invoices/' + invoice.id)).status, 403);
    assert.equal((await t.call('POST', '/api/invoices/' + invoice.id + '/mark-paid-manually')).status, 403);
    assert.equal((await t.call('POST', '/api/invoices/' + invoice.id + '/dispute', { disputed: true })).status, 403);
    const after = (await t.call('GET', '/api/invoices')).json.find((i) => i.id === invoice.id);
    assert.equal(after.status, 'open');
    assert.equal(after.notes, '');
    assert.equal(after.disputed, false);
  } finally { t.close(); }
});


test('rate limiting ignores spoofed forwarded IP headers unless a trusted proxy is explicitly enabled', async () => {
  let t = await boot({ limits: { general: 1 } });
  try {
    assert.equal((await t.call('GET', '/api/health', undefined, { 'X-Forwarded-For': '198.51.100.10' })).status, 200);
    assert.equal((await t.call('GET', '/api/health', undefined, { 'X-Forwarded-For': '203.0.113.20' })).status, 429);
  } finally { t.close(); }
  t = await boot({ env: { TRUST_PROXY: 'true' }, limits: { general: 1 } });
  try {
    assert.equal((await t.call('GET', '/api/health', undefined, { 'X-Forwarded-For': '198.51.100.10' })).status, 200);
    assert.equal((await t.call('GET', '/api/health', undefined, { 'X-Forwarded-For': '203.0.113.20' })).status, 200);
  } finally { t.close(); }
});

test('payment reconciliation preview is read-only and requires completed provider status', async () => {
  const t = await boot();
  try {
    const created = await t.call('POST', '/api/invoices', NEW);
    const before = JSON.stringify({ invoices: t.app.db.invoices, actions: t.app.db.actions, orders: t.app.db.orders });
    const csv = 'Invoice Number,Amount,Currency,Transaction ID,Status\nINV-1,120.50,USD,CAP-1,COMPLETED\nINV-1,120.50,USD,CAP-2,PENDING\nINV-1,120.50,USD,CAP-3,';
    const preview = await t.call('POST', '/api/reconciliation/preview', { csv });
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.json.results.map((x) => x.result), ['candidate', 'not_completed', 'status_missing']);
    assert.equal(preview.json.results[0].invoiceId, created.json.id);
    assert.match(preview.json.results[0].reason, /review candidate only/);
    assert.equal(JSON.stringify({ invoices: t.app.db.invoices, actions: t.app.db.actions, orders: t.app.db.orders }), before);
    assert.equal((await t.call('POST', '/api/reconciliation/preview', { csv: 'invoice,amount\\nINV-1,10' })).status, 400);
  } finally { t.close(); }
});
