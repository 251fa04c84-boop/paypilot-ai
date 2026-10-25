'use strict';
const main = document.getElementById('main');
const state = { tab: 'recovery', detail: null, health: null };

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const money = (n, c) => `${Number(n).toFixed(2)} ${c}`;
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
}
async function api(method, path, body) {
  const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch (_) { /* no body */ }
  if (!res.ok) { const e = new Error((data && data.error) || `Request failed (${res.status})`); e.data = data; e.status = res.status; throw e; }
  return data;
}
async function safe(fn) { try { return await fn(); } catch (e) { toast(e.message); } }

async function loadStatus() {
  const s = document.getElementById('status'); s.textContent = '';
  try {
    state.health = await api('GET', '/api/health');
    const hh = state.health;
    s.append(
      h('span', { class: 'pill ' + (hh.paypal.configured ? 'ok' : 'warn') }, hh.paypal.configured ? 'PayPal Sandbox: connected' : 'PayPal Sandbox: not configured'),
      h('span', { class: 'pill ' + (hh.ai.configured ? 'ok' : 'warn') }, hh.ai.configured ? `AI: ${hh.ai.provider}` : 'AI: template mode (no key)'),
    );
  } catch (_) { s.append(h('span', { class: 'pill warn' }, 'Server unreachable')); }
}

function badge(level) { return h('span', { class: 'badge ' + level }, level === 'none' ? 'no action' : level + ' priority'); }

function invoiceCard(inv, a, onOpen) {
  return h('div', { class: 'card' },
    h('div', { class: 'row' }, h('span', { class: 'name' }, inv.client), badge(a.level)),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, `${inv.number} · ${money(inv.amount, inv.currency)}`), inv.demo && h('span', { class: 'badge demo' }, 'DEMO')),
    h('p', { class: 'muted' }, inv.status === 'paid' ? `Paid (${inv.paymentMethod === 'paypal_sandbox' ? 'PayPal Sandbox, verified' : 'marked manually'})` : (a.overdueDays ? `${a.overdueDays} days overdue` : `Due ${inv.dueDate}`)),
    h('p', {}, a.recommendation),
    h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: onOpen }, 'Open')));
}

function tile(label, value, cur, sub) {
  return h('div', { class: 'tile' }, h('div', { class: 'muted' }, label), h('div', { class: 'big' }, `${Number(value).toFixed(2)} ${cur}`), h('div', { class: 'muted' }, sub));
}
function totals(sum) {
  return sum.map((c) => h('div', { class: 'card' }, h('div', { class: 'row' }, h('span', { class: 'name' }, `Your invoices (${c.currency})`), h('span', { class: 'badge none' }, 'plain maths, no AI')),
    h('div', { class: 'tiles' },
      tile('Outstanding', c.outstanding, c.currency, `${c.openCount} open`),
      tile('Overdue', c.overdue, c.currency, `${c.overdueCount} invoice${c.overdueCount === 1 ? '' : 's'}`),
      tile('At risk (30+ days late)', c.atRisk, c.currency, `${c.atRiskCount} invoice${c.atRiskCount === 1 ? '' : 's'}`),
      tile('Paid via PayPal Sandbox', c.paidViaPayPal, c.currency, 'verified captures'))));
}

async function viewRecovery() {
  const q = await api('GET', '/api/recovery');
  const all = await api('GET', '/api/invoices');
  const sum = all.length ? await api('GET', '/api/summary') : [];
  main.replaceChildren(...totals(sum), h('h2', {}, 'Needs attention'));
  if (!all.length) {
    main.append(h('div', { class: 'card empty' }, h('p', {}, 'No invoices yet. Add one, or load clearly-labelled demo data to try the workflow.'),
      h('div', { class: 'actions center' },
        h('button', { class: 'primary', onclick: () => safe(async () => { await api('POST', '/api/demo/seed'); render(); }) }, 'Load demo data'),
        h('button', { onclick: () => switchTab('invoices') }, 'Add an invoice'))));
    return;
  }
  if (!q.length) main.append(h('div', { class: 'card empty' }, 'Nothing needs attention right now.'));
  q.forEach(({ assessment: a, invoice: inv }) => main.append(invoiceCard(inv, a, () => openDetail(inv.id))));
  if (all.some((i) => i.demo)) main.append(h('div', { class: 'actions' }, h('button', { class: 'danger', onclick: () => safe(async () => { if (confirm('Remove all demo invoices?')) { await api('DELETE', '/api/demo'); render(); } }) }, 'Remove demo data')));
}

async function viewInvoices() {
  const list = await api('GET', '/api/invoices');
  main.replaceChildren(h('h2', {}, 'New invoice'), invoiceForm(), h('h2', {}, 'All invoices'));
  if (!list.length) main.append(h('div', { class: 'card empty' }, 'No invoices yet.'));
  list.forEach((inv) => main.append(invoiceCard(inv, inv.assessment, () => openDetail(inv.id))));
}

function invoiceForm(existing, onDone) {
  const t = new Date().toISOString().slice(0, 10);
  const f = { client: h('input', { required: true, maxlength: 100, value: existing ? existing.client : '' }), number: h('input', { required: true, maxlength: 40, value: existing ? existing.number : '' }),
    amount: h('input', { type: 'number', step: '0.01', min: '0.01', inputmode: 'decimal', required: true, value: existing ? existing.amount : '' }), currency: h('input', { maxlength: 3, value: existing ? existing.currency : 'USD' }),
    issueDate: h('input', { type: 'date', required: true, value: existing ? existing.issueDate : t }), dueDate: h('input', { type: 'date', required: true, value: existing ? existing.dueDate : '' }) };
  const err = h('p', { class: 'err', role: 'alert' });
  const field = (label, el) => h('div', {}, h('label', {}, label), el);
  return h('form', { class: 'card', onsubmit: async (ev) => {
    ev.preventDefault(); err.textContent = '';
    try {
      const body = { client: f.client.value, number: f.number.value, amount: Number(f.amount.value), currency: f.currency.value.toUpperCase(), issueDate: f.issueDate.value, dueDate: f.dueDate.value };
      if (existing) await api('PUT', `/api/invoices/${existing.id}`, body); else await api('POST', '/api/invoices', body);
      toast(existing ? 'Invoice updated.' : 'Invoice added.'); onDone ? onDone() : render();
    } catch (e) { err.textContent = e.message; }
  } }, field('Client name', f.client), field('Invoice number', f.number),
  h('div', { class: 'grid2' }, field('Amount', f.amount), field('Currency', f.currency)),
  h('div', { class: 'grid2' }, field('Issue date', f.issueDate), field('Due date', f.dueDate)), err,
  h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'submit' }, existing ? 'Save changes' : 'Add invoice')));
}

async function openDetail(id) { state.detail = id; await render(); main.focus(); window.scrollTo(0, 0); }

async function viewDetail() {
  const inv = await api('GET', `/api/invoices/${state.detail}`);
  const a = inv.assessment;
  main.replaceChildren(h('button', { class: 'back', onclick: () => { state.detail = null; render(); } }, '← Back'),
    h('h2', {}, inv.client));
  const card = h('div', { class: 'card' },
    h('div', { class: 'row' }, h('span', { class: 'name' }, `${inv.number} · ${money(inv.amount, inv.currency)}`), badge(a.level)),
    h('p', { class: 'muted' }, `Issued ${inv.issueDate} · Due ${inv.dueDate} · Status: ${inv.status}${inv.demo ? ' · DEMO' : ''}`),
    h('p', {}, h('strong', {}, 'Recommended: '), a.recommendation),
    h('details', {}, h('summary', {}, `Why? (priority score ${a.score}/100)`), h('ul', { class: 'why' }, a.reasons.map((r) => h('li', {}, r))),
      h('p', { class: 'muted' }, 'Calculated by fixed rules from the invoice fields (not AI). The score ranks which invoice to chase first. It does not predict whether the client will pay.')));
  main.append(card);

  if (inv.status === 'open') {
    const pay = h('div', { class: 'actions' },
      h('button', { class: 'primary', disabled: !(state.health && state.health.paypal.configured), onclick: () => safe(async () => { const r = await api('POST', `/api/invoices/${inv.id}/pay`); location.href = r.approveUrl; }) }, 'Pay with PayPal Sandbox'),
      h('button', { onclick: () => safe(async () => { if (confirm('Mark as paid without a PayPal payment? It will be recorded as manual.')) { await api('POST', `/api/invoices/${inv.id}/mark-paid-manually`); render(); } }) }, 'Mark paid manually'),
      h('button', { onclick: () => safe(async () => { await api('PUT', `/api/invoices/${inv.id}`, { status: 'void' }); render(); }) }, 'Void'));
    card.append(pay);
    if (!(state.health && state.health.paypal.configured)) card.append(h('p', { class: 'muted' }, 'PayPal Sandbox is not configured on this server, so payment is disabled.'));
  }

  main.append(h('h2', {}, 'Recovery message'));
  const drafts = inv.drafts.slice().reverse();
  if (inv.status === 'open') {
    main.append(h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => safe(async () => {
      try { await api('POST', `/api/invoices/${inv.id}/drafts`, {}); }
      catch (e) { if (e.data && e.data.canForce && confirm(e.message + '\n\nDraft one anyway?')) await api('POST', `/api/invoices/${inv.id}/drafts`, { force: true }); else if (!(e.data && e.data.canForce)) throw e; }
      render();
    }) }, drafts.length ? 'Draft a new message' : 'Draft a message')));
  }
  if (!drafts.length) main.append(h('div', { class: 'card empty' }, 'No drafts yet.'));
  drafts.forEach((d) => main.append(draftCard(d)));

  main.append(h('h2', {}, 'Invoice details'),
    inv.status === 'paid' ? h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Paid invoices are locked.')) : invoiceForm(inv, render));

  main.append(h('h2', {}, 'Audit trail'));
  const tl = h('ul', { class: 'timeline' }, inv.actions.map((x) => h('li', {}, h('time', {}, new Date(x.at).toLocaleString()), x.detail)));
  main.append(h('div', { class: 'card' }, tl));
}

function draftCard(d) {
  const card = h('div', { class: 'card' }, h('div', { class: 'row' }, h('span', { class: 'badge ' + (d.status === 'draft' ? 'medium' : 'low') }, d.status === 'draft' ? 'draft: not approved' : d.status === 'approved' ? 'approved: not sent yet' : 'sent by you'), h('span', { class: 'muted' }, d.source)));
  if (d.status === 'draft') {
    const ta = h('textarea', { maxlength: 2000, 'aria-label': 'Message text' }, d.text); ta.value = d.text;
    card.append(d.source.startsWith('AI:') ? h('p', { class: 'muted' }, 'AI-written text can contain mistakes. Check every detail before approving.') : h('p', { class: 'muted' }, 'This text comes from a fixed template, not AI.'), ta, h('p', { class: 'muted' }, 'Review and edit. {{PAYMENT_LINK}} becomes a PayPal Sandbox payment link when you approve.'),
      h('div', { class: 'actions' },
        h('button', { onclick: () => safe(async () => { await api('PUT', `/api/drafts/${d.id}`, { text: ta.value }); toast('Draft saved.'); }) }, 'Save edits'),
        h('button', { class: 'primary', onclick: () => safe(async () => { await api('PUT', `/api/drafts/${d.id}`, { text: ta.value }); await api('POST', `/api/drafts/${d.id}/approve`); render(); }) }, 'Approve message')));
  } else {
    card.append(h('div', { class: 'draft' }, d.text));
    if (d.status === 'approved') card.append(h('p', { class: 'muted' }, 'PayPilot does not send email or messages. Copy this, send it yourself, then confirm.'),
      h('div', { class: 'actions' },
        h('button', { onclick: async () => { try { await navigator.clipboard.writeText(d.text); toast('Copied.'); } catch (_) { toast('Could not copy. Select the text and copy it manually.'); } } }, 'Copy message'),
        h('button', { class: 'primary', onclick: () => safe(async () => { await api('POST', `/api/drafts/${d.id}/sent`); render(); }) }, 'I sent it')));
  }
  return card;
}

async function viewActivity() {
  const list = await api('GET', '/api/actions');
  main.replaceChildren(h('h2', {}, 'Recent activity'));
  if (!list.length) main.append(h('div', { class: 'card empty' }, 'Nothing has happened yet.'));
  else main.append(h('div', { class: 'card' }, h('ul', { class: 'timeline' }, list.map((x) => h('li', {}, h('time', {}, new Date(x.at).toLocaleString()), x.detail)))));
}

async function render() {
  await safe(async () => {
    if (state.detail) return viewDetail();
    return ({ recovery: viewRecovery, invoices: viewInvoices, activity: viewActivity })[state.tab]();
  });
}
function switchTab(tab) {
  state.tab = tab; state.detail = null;
  document.querySelectorAll('.tabs button').forEach((b) => { if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  render();
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

(async function init() {
  await loadStatus();
  const p = new URLSearchParams(location.search);
  if (p.get('payment') === 'cancelled') toast('Payment cancelled. The invoice is unchanged.');
  if (p.get('payment') === 'return' && p.get('order')) {
    toast('Verifying your payment with PayPal…');
    try {
      const r = await api('POST', '/api/paypal/capture', { orderId: p.get('order') });
      toast(r.message); if (r.invoiceId) state.detail = r.invoiceId;
    } catch (e) { toast(e.message); }
  }
  if (p.has('payment')) history.replaceState(null, '', '/');
  render();
})();
