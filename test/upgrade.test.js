'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDraft, generateDraft } = require('../lib/ai');
const { summarize } = require('../lib/summary');
const { createLimiter } = require('../lib/ratelimit');
const { createStore } = require('../lib/store');
const { createApp } = require('../server');

const inv = { id: 'a1', client: 'Acme', number: 'INV-1', amount: 120.5, currency: 'USD', dueDate: '2026-02-20', reminderCount: 0 };
const a = { overdueDays: 18, tone: 'firm' };
const GOOD = 'Hi Acme, invoice INV-1 for 120.50 USD is overdue. Please pay here: {{PAYMENT_LINK}} Thank you.';
const respond = (text) => async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });

test('AI output validation: accepts good drafts, rejects unsafe ones', () => {
  assert.equal(validateDraft(GOOD, inv).ok, true);
  assert.equal(validateDraft('short', inv).reason, 'too short');
  assert.equal(validateDraft('x'.repeat(1600), inv).reason, 'too long');
  assert.match(validateDraft(GOOD + ' See https://evil.example/pay', inv).reason, /invented a link/);
  assert.match(validateDraft(GOOD + ' {{SECRET}}', inv).reason, /placeholder/);
  assert.match(validateDraft(GOOD + ' {{PAYMENT_LINK}}', inv).reason, /repeated/);
  assert.match(validateDraft('Hello there, please pay what you owe soon. {{PAYMENT_LINK}} Thanks.', inv).reason, /does not mention/);
  assert.ok(validateDraft('Hi Acme, invoice INV-1 for 120.50 USD is overdue. Please pay soon, thank you.', inv).text.endsWith('{{PAYMENT_LINK}}')); // link added if the model forgot it
  assert.ok(!validateDraft('```text\n' + GOOD + '\n```', inv).text.includes('```')); // code fences stripped
});

test('generateDraft: labels are honest in every outcome', async () => {
  const ok = await generateDraft({ invoice: inv, assessment: a, apiKey: 'k', fetchImpl: respond(GOOD) });
  assert.match(ok.source, /^AI: Google Gemini/);
  const evil = await generateDraft({ invoice: inv, assessment: a, apiKey: 'k', fetchImpl: respond(GOOD + ' https://evil.example') });
  assert.match(evil.source, /template \(AI output rejected: it invented a link\)/); assert.ok(!/https?:/.test(evil.text));
  const bad = await generateDraft({ invoice: inv, assessment: a, apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid' } }) }) });
  assert.match(bad.source, /template \(AI request failed: HTTP 400 - API key not valid\)/);
  const slow = await generateDraft({ invoice: inv, assessment: a, apiKey: 'k', timeoutMs: 30, fetchImpl: (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))) });
  assert.match(slow.source, /timed out/);
  const none = await generateDraft({ invoice: inv, assessment: a });
  assert.match(none.source, /no AI key configured/);
});

test('summary totals are exact and grouped per currency', () => {
  const mk = (id, amount, dueDate, extra = {}) => Object.assign({ id, client: 'c', number: id, amount, currency: 'USD', issueDate: '2026-01-01', dueDate, status: 'open', reminderCount: 0 }, extra);
  const list = [mk('a', 100.1, '2026-03-01'), mk('b', 200.2, '2026-01-20'), mk('c', 50, '2026-03-12'), mk('d', 70, '2026-06-01'),
    mk('e', 10, '2026-01-01', { status: 'paid', paymentMethod: 'paypal_sandbox' }), mk('f', 5, '2026-01-01', { status: 'paid', paymentMethod: 'manual' }), mk('g', 9, '2026-01-01', { currency: 'EUR' })];
  const s = summarize(list, '2026-03-10');
  const usd = s.find((x) => x.currency === 'USD');
  assert.equal(usd.outstanding, 420.3); assert.equal(usd.overdue, 300.3); assert.equal(usd.atRisk, 200.2); assert.equal(usd.dueSoon, 50);
  assert.equal(usd.paidViaPayPal, 10); assert.equal(usd.paidOther, 5); assert.equal(usd.overdueCount, 2);
  assert.equal(s.find((x) => x.currency === 'EUR').overdue, 9);
});

test('rate limiter blocks after the limit and recovers after the window', () => {
  const l = createLimiter({ windowMs: 1000, max: 2 });
  assert.equal(l.hit('ip', 0).ok, true); assert.equal(l.hit('ip', 10).ok, true);
  const b = l.hit('ip', 20); assert.equal(b.ok, false); assert.ok(b.retryAfter >= 1);
  assert.equal(l.hit('other', 20).ok, true);
  assert.equal(l.hit('ip', 1200).ok, true);
});

async function boot(limits, paypal) {
  const app = createApp({ env: { APP_BASE_URL: 'http://t.local' }, store: createStore(null), limits, paypal, now: () => new Date('2026-03-10T12:00:00Z') });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await res.json(); } catch (_) {}
    return { status: res.status, json, headers: res.headers };
  };
  return { app, call, close: () => app.server.close() };
}

test('API: summary endpoint and draft rate limit (429 + Retry-After)', async () => {
  const t = await boot({ draftIp: 2 });
  try {
    await t.call('POST', '/api/demo/seed');
    const s = (await t.call('GET', '/api/summary')).json;
    assert.equal(s.length, 1); assert.ok(s[0].outstanding > 0 && s[0].overdue > 0 && s[0].atRisk > 0);
    const id = t.app.db.invoices.find((i) => i.dueDate < '2026-03-10' && i.status === 'open' && !i.lastReminderAt).id;
    assert.equal((await t.call('POST', `/api/invoices/${id}/drafts`, {})).status, 201);
    assert.equal((await t.call('POST', `/api/invoices/${id}/drafts`, {})).status, 201);
    const blocked = await t.call('POST', `/api/invoices/${id}/drafts`, {});
    assert.equal(blocked.status, 429); assert.match(blocked.json.error, /Too many requests/); assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
    assert.equal((await t.call('GET', '/api/invoices')).status, 200); // other routes still work
  } finally { t.close(); }
});

test('AI model fallback: busy or retired models fall through; key errors do not', async () => {
  const urls = [];
  const seq = (...steps) => async (url) => { urls.push(url); const s = steps[urls.length - 1]; return s === 'ok' ? respond(GOOD)() : { ok: false, status: s, json: async () => ({ error: { message: 'x' } }) }; };
  urls.length = 0;
  const r1 = await generateDraft({ invoice: inv, assessment: a, apiKey: 'k', fetchImpl: seq(503, 'ok') });
  assert.equal(r1.source, 'AI: Google Gemini (gemini-3.8-flash)'); assert.equal(urls.length, 2);
  assert.ok(urls[0].includes('gemini-3.5-flash-lite'));
  urls.length = 0;
  const r2 = await generateDraft({ invoice: inv, assessment: a, apiKey: 'k', model: 'gemini-2.5-flash', fetchImpl: seq(404, 'ok') });
  assert.equal(r2.source, 'AI: Google Gemini (gemini-3.5-flash-lite)'); assert.ok(urls[0].includes('gemini-2.5-flash:'));
  urls.length = 0;
  const r3 = await generateDraft({ invoice: inv, assessment: a, apiKey: 'k', fetchImpl: seq(403, 'ok') });
  assert.equal(urls.length, 1); assert.match(r3.source, /template \(AI request failed: HTTP 403 - x\)/);
  urls.length = 0;
  const r4 = await generateDraft({ invoice: inv, assessment: a, apiKey: 'k', fetchImpl: seq(503, 503) });
  assert.match(r4.source, /template \(AI request failed: HTTP 503 - x \(tried 2 models\)\)/);
});

test('API: tapping Pay twice reuses the open PayPal order instead of creating another', async () => {
  let created = 0;
  const pp = { configured: () => true, createOrder: async () => { created++; return { id: 'ORD' + created, approveUrl: 'https://sandbox.paypal.test/a/' + created }; } };
  const t = await boot(undefined, pp);
  try {
    const id = (await t.call('POST', '/api/invoices', { client: 'A', number: 'N1', amount: 10, currency: 'USD', issueDate: '2026-01-01', dueDate: '2026-02-01' })).json.id;
    const a1 = (await t.call('POST', `/api/invoices/${id}/pay`)).json.approveUrl;
    const a2 = (await t.call('POST', `/api/invoices/${id}/pay`)).json.approveUrl;
    assert.equal(a1, a2); assert.equal(created, 1); assert.equal(t.app.db.orders.length, 1);
  } finally { t.close(); }
});

test('API: a paid invoice cannot approve a message, and its drafts are closed', async () => {
  const t = await boot();
  try {
    const id = (await t.call('POST', '/api/invoices', { client: 'A', number: 'N9', amount: 10, currency: 'USD', issueDate: '2026-01-01', dueDate: '2026-02-01' })).json.id;
    const d = (await t.call('POST', `/api/invoices/${id}/drafts`, {})).json;
    await t.call('POST', `/api/invoices/${id}/mark-paid-manually`);
    const detail = (await t.call('GET', `/api/invoices/${id}`)).json;
    assert.equal(detail.drafts[0].status, 'discarded');
    assert.equal((await t.call('POST', `/api/drafts/${d.id}/approve`)).status, 409);
    assert.ok(detail.actions.some((x) => x.type === 'drafts_closed'));
  } finally { t.close(); }
});
