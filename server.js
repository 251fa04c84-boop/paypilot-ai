'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createStore, addAction, newId } = require('./lib/store');
const P = require('./lib/priority');
const { applyCapture } = require('./lib/payments');
const { createPayPal } = require('./lib/paypal');
const { generateDraft } = require('./lib/ai');

const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }

function createApp(opts = {}) {
  const env = opts.env || process.env;
  const port = Number(env.PORT) || 3000;
  const baseUrl = (env.APP_BASE_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/$/, '');
  const now = opts.now || (() => new Date());
  const store = opts.store || createStore(env.DATA_FILE || path.join(__dirname, 'data', 'db.json'));
  const db = store.db;
  const paypal = opts.paypal || createPayPal({ clientId: env.PAYPAL_CLIENT_ID, secret: env.PAYPAL_CLIENT_SECRET });
  const aiFetch = opts.aiFetch || fetch;
  const aiKey = env.GEMINI_API_KEY || '';
  const aiModel = env.GEMINI_MODEL || 'gemini-2.5-flash';
  const sender = env.SENDER_NAME || 'Accounts team';
  const inflight = new Set();
  const iso = () => now().toISOString();
  const todayStr = () => P.today(now());

  const find = (list, id, label) => { const x = list.find((i) => i.id === id); if (!x) throw new HttpError(404, `${label} not found.`); return x; };
  const withA = (inv) => Object.assign({}, inv, { assessment: P.assess(inv, todayStr()) });

  function cleanInvoice(b, base = {}) {
    const inv = Object.assign({}, base);
    for (const k of ['client', 'number', 'currency', 'issueDate', 'dueDate', 'notes']) if (k in b) inv[k] = typeof b[k] === 'string' ? b[k].trim() : b[k];
    if ('amount' in b) inv.amount = typeof b.amount === 'string' ? Number(b.amount) : b.amount;
    if (typeof inv.amount === 'number') inv.amount = Math.round(inv.amount * 100) / 100;
    if (typeof inv.currency === 'string') inv.currency = inv.currency.toUpperCase();
    const errors = P.validateInvoice(inv);
    if (errors.length) throw new HttpError(400, errors.join(' '), { errors });
    return inv;
  }

  async function startPayment(inv) {
    if (!paypal.configured()) throw new HttpError(503, 'PayPal Sandbox is not configured on this server.');
    if (inv.status !== 'open') throw new HttpError(409, `Invoice is ${inv.status}; it cannot be paid.`);
    const o = await paypal.createOrder({ invoice: inv, requestId: `pp-${newId()}`, returnUrl: `${baseUrl}/paypal/return`, cancelUrl: `${baseUrl}/paypal/cancel` });
    db.orders.push({ orderId: o.id, invoiceId: inv.id, amount: inv.amount, currency: inv.currency, status: 'created', createdAt: iso() });
    addAction(db, { invoiceId: inv.id, type: 'payment_link_created', detail: `PayPal Sandbox order ${o.id} created. Waiting for the buyer to approve.` }, iso());
    store.save();
    return o.approveUrl;
  }

  async function capture(orderId) {
    if (typeof orderId !== 'string' || !/^[A-Za-z0-9-]{5,40}$/.test(orderId)) throw new HttpError(400, 'Invalid order id.');
    const rec = db.orders.find((o) => o.orderId === orderId);
    if (!rec) throw new HttpError(404, 'Unknown order. Only orders created by this app can be captured.');
    if (rec.status === 'captured') return { outcome: 'paid', message: 'Already recorded. No second capture was made.', invoiceId: rec.invoiceId };
    if (rec.status === 'cancelled') return { outcome: 'cancelled', message: 'This payment was cancelled.', invoiceId: rec.invoiceId };
    if (rec.status === 'failed') return { outcome: 'failed', message: 'This order already failed verification. Start a new payment.', invoiceId: rec.invoiceId };
    if (inflight.has(orderId)) throw new HttpError(409, 'This payment is already being processed.');
    inflight.add(orderId);
    try {
      let order;
      try { order = await paypal.captureOrder(orderId); }
      catch (e) { if (e.code === 'NOT_APPROVED') throw new HttpError(409, e.message); throw new HttpError(502, e.message); }
      const result = applyCapture(db, rec, order, now());
      store.save();
      return Object.assign({ invoiceId: rec.invoiceId }, result);
    } finally { inflight.delete(orderId); }
  }

  function seedDemo() {
    if (db.invoices.some((i) => i.demo)) throw new HttpError(409, 'Demo data already exists.');
    const t = todayStr();
    const d = (n) => new Date(Date.parse(t + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
    const rows = [
      ['Acme Studio (demo)', 'D-1001', 1200, -65, -35, 1, -10], ['Northwind Cafe (demo)', 'D-1002', 340, -33, -3],
      ['Bright Labs (demo)', 'D-1003', 2800, -42, -12], ['Orbit Fitness (demo)', 'D-1004', 150, -28, 2],
      ['Greenleaf Co (demo)', 'D-1005', 600, -50, -20, 1, -1], ['Lumen Books (demo)', 'D-1006', 90, -40, -10, 0, null, 'paid'],
    ];
    for (const [client, number, amount, iss, due, rc, lr, st] of rows) {
      db.invoices.push({ id: newId(), client, number, amount, currency: 'USD', issueDate: d(iss), dueDate: d(due), status: st || 'open', notes: '', demo: true, reminderCount: rc || 0, lastReminderAt: lr == null ? null : d(lr), createdAt: iso() });
    }
    store.save();
  }

  const routes = [];
  const route = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return '([A-Za-z0-9-]+)'; }) + '$');
    routes.push({ method, re, keys, handler });
  };

  route('GET', '/api/health', () => ({ json: { ok: true, today: todayStr(), storage: 'json-file', ai: { configured: Boolean(aiKey), provider: aiKey ? `Google Gemini (${aiModel})` : null }, paypal: { configured: paypal.configured(), environment: 'sandbox' } } }));
  route('GET', '/api/invoices', () => ({ json: db.invoices.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(withA) }));
  route('POST', '/api/invoices', ({ body }) => {
    const inv = cleanInvoice(body, { id: newId(), status: 'open', demo: false, reminderCount: 0, lastReminderAt: null, createdAt: iso() });
    if (!('currency' in body)) inv.currency = 'USD';
    db.invoices.push(inv);
    addAction(db, { invoiceId: inv.id, type: 'invoice_created', detail: `Invoice ${inv.number} created for ${inv.amount.toFixed(2)} ${inv.currency}.` }, iso());
    store.save();
    return { status: 201, json: withA(inv) };
  });
  route('GET', '/api/invoices/:id', ({ params }) => {
    const inv = find(db.invoices, params.id, 'Invoice');
    return { json: Object.assign(withA(inv), { drafts: db.drafts.filter((d) => d.invoiceId === inv.id), actions: db.actions.filter((a) => a.invoiceId === inv.id).reverse() }) };
  });
  route('PUT', '/api/invoices/:id', ({ params, body }) => {
    const inv = find(db.invoices, params.id, 'Invoice');
    if (inv.status === 'paid') throw new HttpError(409, 'Paid invoices cannot be edited.');
    const upd = cleanInvoice(body, inv);
    if (body.status === 'void' || body.status === 'open') upd.status = body.status;
    Object.assign(inv, upd);
    addAction(db, { invoiceId: inv.id, type: 'invoice_updated', detail: `Invoice ${inv.number} edited (status: ${inv.status}).` }, iso());
    store.save();
    return { json: withA(inv) };
  });
  route('DELETE', '/api/invoices/:id', ({ params }) => {
    const inv = find(db.invoices, params.id, 'Invoice');
    if (inv.paymentMethod === 'paypal_sandbox') throw new HttpError(409, 'Invoices with a recorded PayPal payment cannot be deleted. Void is not available once paid; keep it for the audit trail.');
    db.invoices = db.invoices.filter((i) => i.id !== inv.id); store.db.invoices = db.invoices;
    for (const k of ['drafts', 'orders', 'actions']) { const keep = db[k].filter((x) => x.invoiceId !== inv.id); db[k].length = 0; db[k].push(...keep); }
    store.save();
    return { json: { deleted: true } };
  });
  route('POST', '/api/invoices/:id/mark-paid-manually', ({ params }) => {
    const inv = find(db.invoices, params.id, 'Invoice');
    if (inv.status !== 'open') throw new HttpError(409, `Invoice is ${inv.status}.`);
    inv.status = 'paid'; inv.paidAt = todayStr(); inv.paymentMethod = 'manual';
    addAction(db, { invoiceId: inv.id, type: 'marked_paid_manually', detail: 'You marked this invoice paid manually. No PayPal payment was verified.' }, iso());
    store.save();
    return { json: withA(inv) };
  });
  route('GET', '/api/recovery', () => {
    const q = P.recoveryQueue(db.invoices, todayStr());
    return { json: q.map((a) => ({ assessment: a, invoice: db.invoices.find((i) => i.id === a.invoiceId) })) };
  });
  route('GET', '/api/actions', () => ({ json: db.actions.slice(-100).reverse() }));

  route('POST', '/api/invoices/:id/drafts', async ({ params, body }) => {
    const inv = find(db.invoices, params.id, 'Invoice');
    if (inv.status !== 'open') throw new HttpError(409, `Invoice is ${inv.status}; no recovery message needed.`);
    let a = P.assess(inv, todayStr());
    if (!a.tone) {
      if (!body.force) throw new HttpError(409, a.recommendation, { canForce: true });
      a = Object.assign({}, a, { tone: 'friendly' });
    }
    const r = await generateDraft({ invoice: inv, assessment: a, sender, apiKey: aiKey, model: aiModel, fetchImpl: aiFetch });
    const draft = { id: newId(), invoiceId: inv.id, text: r.text, source: r.source, tone: a.tone, status: 'draft', createdAt: iso() };
    db.drafts.push(draft);
    addAction(db, { invoiceId: inv.id, type: 'draft_generated', detail: `Draft created (${r.source}). Not approved, not sent.` }, iso());
    store.save();
    return { status: 201, json: draft };
  });
  route('PUT', '/api/drafts/:id', ({ params, body }) => {
    const d = find(db.drafts, params.id, 'Draft');
    if (d.status !== 'draft') throw new HttpError(409, 'Only drafts that are not yet approved can be edited.');
    if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 2000) throw new HttpError(400, 'Message text is required (max 2000 characters).');
    if (d.text !== body.text) {
      d.text = body.text; d.edited = true;
      addAction(db, { invoiceId: d.invoiceId, type: 'draft_edited', detail: 'You edited the draft.' }, iso());
      store.save();
    }
    return { json: d };
  });
  route('POST', '/api/drafts/:id/approve', ({ params }) => {
    const d = find(db.drafts, params.id, 'Draft');
    if (d.status !== 'draft') throw new HttpError(409, `Draft is already ${d.status}.`);
    d.text = d.text.split('{{PAYMENT_LINK}}').join(`${baseUrl}/pay/${d.invoiceId}`);
    d.status = 'approved'; d.approvedAt = iso();
    addAction(db, { invoiceId: d.invoiceId, type: 'draft_approved', detail: 'You approved the message. PayPilot does not send email: copy it and send it yourself, then confirm below.' }, iso());
    store.save();
    return { json: d };
  });
  route('POST', '/api/drafts/:id/sent', ({ params }) => {
    const d = find(db.drafts, params.id, 'Draft');
    if (d.status !== 'approved') throw new HttpError(409, 'Only approved drafts can be marked as sent.');
    const inv = find(db.invoices, d.invoiceId, 'Invoice');
    d.status = 'sent'; d.sentAt = iso();
    inv.reminderCount = (inv.reminderCount || 0) + 1; inv.lastReminderAt = todayStr();
    addAction(db, { invoiceId: inv.id, type: 'reminder_sent_by_user', detail: `You confirmed you sent reminder #${inv.reminderCount} yourself (outside this app).` }, iso());
    store.save();
    return { json: { draft: d, invoice: withA(inv) } };
  });

  route('POST', '/api/invoices/:id/pay', async ({ params }) => ({ json: { approveUrl: await startPayment(find(db.invoices, params.id, 'Invoice')) } }));
  route('POST', '/api/paypal/capture', async ({ body }) => ({ json: await capture(body.orderId) }));
  route('GET', '/pay/:id', async ({ params }) => {
    const inv = db.invoices.find((i) => i.id === params.id);
    if (!inv) return { status: 404, html: page('Invoice not found', 'This payment link is not valid.') };
    if (inv.status !== 'open') return { html: page('Nothing to pay', `Invoice ${esc(inv.number)} is ${esc(inv.status)}.`) };
    try { return { redirect: await startPayment(inv) }; }
    catch (e) { return { status: e.status || 500, html: page('Payment unavailable', esc(e.status ? e.message : 'Could not start the payment.')) }; }
  });
  route('GET', '/paypal/return', ({ query }) => ({ redirect: `/?payment=return&order=${encodeURIComponent(String(query.token || '').replace(/[^A-Za-z0-9-]/g, ''))}` }));
  route('GET', '/paypal/cancel', ({ query }) => {
    const rec = db.orders.find((o) => o.orderId === query.token);
    if (rec && rec.status === 'created') {
      rec.status = 'cancelled';
      addAction(db, { invoiceId: rec.invoiceId, type: 'payment_cancelled', detail: `Buyer cancelled PayPal Sandbox order ${rec.orderId}. Invoice unchanged.` }, iso());
      store.save();
    }
    return { redirect: '/?payment=cancelled' };
  });
  route('POST', '/api/demo/seed', () => { seedDemo(); return { status: 201, json: { seeded: true } }; });
  route('DELETE', '/api/demo', () => {
    const ids = new Set(db.invoices.filter((i) => i.demo).map((i) => i.id));
    db.invoices = db.invoices.filter((i) => !ids.has(i.id)); store.db.invoices = db.invoices;
    for (const k of ['drafts', 'orders', 'actions']) { const keep = db[k].filter((x) => !ids.has(x.invoiceId)); db[k].length = 0; db[k].push(...keep); }
    store.save();
    return { json: { removed: ids.size } };
  });

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function page(title, msg) { return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1>${esc(title)}</h1><p>${msg}</p><p><a href="/">Back to PayPilot AI</a></p></body>`; }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > 100000) { reject(new HttpError(413, 'Request too large.')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(v && typeof v === 'object' ? v : {}); }
        catch (_) { reject(new HttpError(400, 'Invalid JSON.')); }
      });
      req.on('error', reject);
    });
  }

  function serveStatic(req, res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    try {
      const m = routes.map((r) => ({ r, x: r.re.exec(url.pathname) })).find(({ r, x }) => x && r.method === req.method);
      if (!m) {
        if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
        throw new HttpError(404, 'Not found.');
      }
      const params = {}; m.r.keys.forEach((k, i) => { params[k] = m.x[i + 1]; });
      const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : {};
      const out = await m.r.handler({ params, body, query: Object.fromEntries(url.searchParams) });
      if (out.redirect) { res.writeHead(302, { Location: out.redirect }); return res.end(); }
      if (out.html) { res.writeHead(out.status || 200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(out.html); }
      res.writeHead(out.status || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out.json));
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error('Internal error:', e.message);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(Object.assign({ error: status === 500 ? 'Internal error.' : e.message }, e.extra || {})));
    }
  });
  return { server, port, db, store };
}

if (require.main === module) {
  const app = createApp();
  app.server.listen(app.port, () => console.log(`PayPilot AI listening on port ${app.port}`));
}
module.exports = { createApp };
