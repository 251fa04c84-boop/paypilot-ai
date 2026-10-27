'use strict';
const main = document.getElementById('main');
const state = { tab: 'mission', detail: null, health: null };

const STATUS = { pending: 'waiting for your approval', approved: 'approved, not run yet', rejected: 'rejected', expired: 'expired', executed: 'run: next step is yours', verified: 'verified by PayPal', confirmed: 'you confirmed it was sent', failed: 'blocked or failed', cancelled: 'cancelled' };
const STCLASS = { pending: 'warn', approved: 'warn', rejected: 'none', expired: 'none', executed: 'cyan', verified: 'ok', confirmed: 'ok', failed: 'bad', cancelled: 'none' };

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
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 7000);
}
async function api(method, path, body) {
  const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch (_) { /* no body */ }
  if (!res.ok) { const e = new Error((data && data.error) || `Request failed (${res.status})`); e.data = data; e.status = res.status; throw e; }
  return data;
}
async function safe(fn) { try { return await fn(); } catch (e) { toast(e.message); } }
// Locks a button while its action runs, so a double tap cannot repeat a sensitive action.
const lock = (label, fn) => async (ev) => {
  const b = ev.currentTarget, orig = b.textContent; b.disabled = true; b.textContent = label;
  try { await fn(); } catch (e) { toast(e.message); } finally { if (b.isConnected) { b.disabled = false; b.textContent = orig; } }
};

// ---------- status ----------
const pill = (cls, text) => h('span', { class: 'pill ' + cls }, text);
function aiPill(ai) {
  if (!ai.configured) return pill('warn', 'AI: template mode (no key)');
  if (ai.last && !ai.last.ok) return pill('warn', `AI: ${ai.provider} · last call failed, fallback used`);
  return pill('ok', `AI: ${ai.provider}${ai.last ? ' · last call OK' : ''}`);
}
async function loadStatus() {
  const s = document.getElementById('status'); s.textContent = '';
  try {
    const hh = state.health = await api('GET', '/api/health');
    s.append(pill(hh.paypal.configured ? 'ok' : 'warn', hh.paypal.configured ? 'PayPal Sandbox: connected' : 'PayPal Sandbox: not configured'), aiPill(hh.ai), pill('warn', 'Restricted demo · demo data only'));
    if (hh.demo.simulateAi) s.append(pill('bad', 'SIMULATED AI outage'));
    if (hh.demo.simulatePaypal) s.append(pill('bad', 'SIMULATED PayPal outage'));
  } catch (_) { s.append(pill('bad', 'Server unreachable')); }
  refreshBadge();
}
async function refreshBadge() {
  try {
    const n = (await api('GET', '/api/proposals?open=1')).filter((p) => p.status === 'pending' || p.status === 'approved').length;
    const b = document.getElementById('badge'); b.hidden = !n; b.textContent = n;
  } catch (_) { /* badge is optional */ }
}

// ---------- shared pieces ----------
const badge = (level) => h('span', { class: 'badge ' + level }, level === 'none' ? 'no action' : level + ' priority');
function invoiceCard(inv, a, onOpen) {
  return h('div', { class: 'card' },
    h('div', { class: 'row' }, h('span', { class: 'name' }, inv.client), badge(a.level)),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, `${inv.number} · ${money(inv.amount, inv.currency)}`), h('span', {}, inv.disputed && h('span', { class: 'badge bad' }, 'DISPUTED'), ' ', inv.demo && h('span', { class: 'badge demo' }, 'DEMO'))),
    h('p', { class: 'muted' }, inv.status === 'paid' ? `Paid (${inv.paymentMethod === 'paypal_sandbox' ? 'PayPal Sandbox, verified' : inv.paymentMethod === 'manual' ? 'marked manually' : 'demo record'})` : (a.overdueDays ? `${a.overdueDays} days overdue` : `Due ${inv.dueDate}`)),
    h('p', {}, a.recommendation),
    h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: onOpen }, 'Open')));
}
const tile = (label, value, cur, sub) => h('div', { class: 'tile' }, h('div', { class: 'muted small' }, label), h('div', { class: 'big' }, `${Number(value).toFixed(2)} ${cur}`), h('div', { class: 'muted small' }, sub));
function totals(sum) {
  return sum.map((c) => h('div', { class: 'card glow' }, h('div', { class: 'row' }, h('span', { class: 'name' }, `Recovery metrics (${c.currency})`), h('span', { class: 'badge none' }, 'plain arithmetic, no AI')),
    h('div', { class: 'tiles' },
      tile('Outstanding', c.outstanding, c.currency, `${c.openCount} open`),
      tile('Overdue', c.overdue, c.currency, `${c.overdueCount} invoice${c.overdueCount === 1 ? '' : 's'}`),
      tile('At risk (30+ days late)', c.atRisk, c.currency, `${c.atRiskCount} invoice${c.atRiskCount === 1 ? '' : 's'}`),
      tile('Disputed (paused)', c.disputed, c.currency, `${c.disputedCount} invoice${c.disputedCount === 1 ? '' : 's'}`),
      tile('Paid via PayPal Sandbox', c.paidViaPayPal, c.currency, 'verified captures'))));
}
function auditClass(t) {
  if (['action_blocked', 'verification_failed', 'payment_failed', 'duplicate_payment'].includes(t)) return 't-blocked';
  if (t === 'service_error') return 't-service';
  if (['result_verified', 'payment_captured', 'action_completed', 'reminder_confirmed_by_user'].includes(t)) return 't-ok';
  if (['approval_requested', 'approval_granted', 'approval_rejected', 'approval_expired', 'approval_cancelled'].includes(t)) return 't-ask';
  if (['analysis_created', 'ai_interpretation', 'untrusted_text_flagged'].includes(t)) return 't-ai';
  return '';
}
const timeline = (list) => h('ul', { class: 'timeline' }, list.map((x) => h('li', { class: auditClass(x.type) }, h('time', {}, new Date(x.at).toLocaleString()), x.detail)));

// ---------- approval review card ----------
function proposalCard(p) {
  const inv = p.invoice || { client: '?', number: '?', amount: 0, currency: '' };
  const live = p.status === 'pending' || p.status === 'approved';
  const card = h('div', { class: 'card ' + (p.status === 'pending' ? 'glow' : '') },
    h('div', { class: 'row' }, h('span', { class: 'name' }, p.title), h('span', { class: 'badge ' + STCLASS[p.status] }, STATUS[p.status])),
    h('p', { class: 'muted' }, `${inv.client} · ${inv.number} · ${money(inv.amount, inv.currency)}`),
    h('p', {}, h('strong', {}, 'Proposed action: '), p.purpose),
    p.payload && p.payload.text && h('div', {}, h('div', { class: 'muted small' }, `Exact message (source: ${p.payload.source}). This is a draft: PayPilot does not send it.`), h('div', { class: 'draft' }, p.payload.text)),
    p.action === 'start_checkout' && h('p', { class: 'muted' }, `Amount: ${money(inv.amount, inv.currency)} (Sandbox, test money only).`),
    h('p', { class: 'muted' }, h('strong', {}, 'Expected outcome: '), p.expected),
    h('p', { class: 'muted' }, h('strong', {}, 'Risks: '), p.risks.join(' ')),
    live && h('p', { class: 'muted small' }, `Expires ${new Date(p.expiresAt).toLocaleTimeString()}. Revalidated again just before it runs.`),
    p.error && h('p', { class: 'err' }, p.error + (p.retryable ? ' You can retry.' : '')),
    p.status === 'verified' && h('p', { class: 'warnbox', style: false }, `Verified by PayPal: capture ${p.captureId}.`));
  const bar = h('div', { class: 'actions' });
  const finish = async () => { await render(); await loadStatus(); };
  if (p.status === 'pending') {
    bar.append(h('button', { class: 'primary', onclick: lock('Working…', async () => {
      await api('POST', `/api/proposals/${p.id}/decision`, { decision: 'approve' });
      try { toast((await api('POST', `/api/proposals/${p.id}/execute`)).message); } catch (e) { toast(e.message); }
      await finish();
    }) }, 'Approve and run'), h('button', { class: 'danger', onclick: lock('Rejecting…', async () => { await api('POST', `/api/proposals/${p.id}/decision`, { decision: 'reject' }); await finish(); }) }, 'Reject'));
  } else if (p.status === 'approved') {
    bar.append(h('button', { class: 'primary', onclick: lock('Retrying…', async () => { try { toast((await api('POST', `/api/proposals/${p.id}/execute`)).message); } catch (e) { toast(e.message); } await finish(); }) }, 'Run now / retry'));
  } else if (p.status === 'executed' && p.action === 'send_reminder') {
    bar.append(h('button', { onclick: async () => { try { await navigator.clipboard.writeText(p.payload.text); toast('Copied.'); } catch (_) { toast('Could not copy. Select the text and copy it manually.'); } } }, 'Copy message'),
      h('button', { class: 'primary', onclick: lock('Saving…', async () => { await api('POST', `/api/proposals/${p.id}/confirm-sent`); await finish(); }) }, 'I sent it myself'));
  } else if (p.status === 'executed' && p.action === 'start_checkout' && p.result && p.result.approveUrl) {
    bar.append(h('a', { class: 'btn primary', href: p.result.approveUrl }, 'Open PayPal Sandbox checkout'), h('span', { class: 'muted small' }, 'Not paid yet. When PayPal sends you back, the server verifies the payment.'));
  }
  if (bar.children.length) card.append(bar);
  return card;
}

// ---------- views ----------
async function viewMission() {
  const [q, all, open] = await Promise.all([api('GET', '/api/recovery'), api('GET', '/api/invoices'), api('GET', '/api/proposals?open=1')]);
  const sum = all.length ? await api('GET', '/api/summary') : [];
  const waiting = open.filter((p) => p.status === 'pending' || p.status === 'approved');
  main.replaceChildren(h('h2', {}, 'Recovery Mission Control'), ...totals(sum));
  if (waiting.length) main.append(h('div', { class: 'card glow' }, h('div', { class: 'row' }, h('span', { class: 'name' }, `${waiting.length} approval${waiting.length === 1 ? '' : 's'} waiting for you`), h('button', { class: 'primary', onclick: () => switchTab('approvals') }, 'Review'))));
  main.append(h('h2', {}, 'Priority queue'));
  if (!all.length) main.append(h('div', { class: 'card empty' }, h('p', {}, 'No invoices yet. Add one, or load the clearly labelled demo scenarios.'), h('div', { class: 'actions center' }, h('button', { class: 'primary', onclick: lock('Loading…', async () => { await api('POST', '/api/demo/seed'); await render(); }) }, 'Load demo scenarios'), h('button', { onclick: () => switchTab('invoices') }, 'Add an invoice'))));
  else if (!q.length) main.append(h('div', { class: 'card empty' }, 'Nothing needs attention right now.'));
  q.forEach(({ assessment: a, invoice: inv }) => main.append(invoiceCard(inv, a, () => openDetail(inv.id))));
  main.append(demoPanel(all));
}
function demoPanel(all) {
  const hh = state.health || { demo: {} };
  const hasDemo = all.some((i) => i.demo);
  const sim = (key, label) => h('button', { class: hh.demo[key === 'ai' ? 'simulateAi' : 'simulatePaypal'] ? 'danger' : '', onclick: lock('Switching…', async () => { await api('POST', '/api/demo/simulate', { [key]: !hh.demo[key === 'ai' ? 'simulateAi' : 'simulatePaypal'] }); await loadStatus(); await render(); }) }, `${hh.demo[key === 'ai' ? 'simulateAi' : 'simulatePaypal'] ? 'Stop simulating' : 'Simulate'} ${label} outage`);
  return h('details', { class: 'card' }, h('summary', {}, 'Demo mode: scenarios for judges'),
    h('p', { class: 'muted' }, 'Everything here is demo data. Simulated outages are labelled SIMULATED and only exist in this demo.'),
    h('ul', { class: 'list' },
      h('li', {}, 'Scenario 1, overdue: open Northwind Cafe, then Request approval for a reminder, approve, and later a Sandbox checkout.'),
      h('li', {}, 'Scenario 2, disputed: open Harbor Dental. The agent pauses collection and blocks the actions.'),
      h('li', {}, 'Scenario 3, already paid: open Lumen Books, or pay Scenario 1 and try again. The action is blocked with the evidence.'),
      h('li', {}, 'Scenario 4, outage: switch on a simulated outage below, then try an action. Nothing is faked and the action can be retried.'),
      h('li', {}, 'Injection test: Injection Test has hostile text in its notes. The agent treats it as data.')),
    h('div', { class: 'actions' }, hasDemo ? h('button', { class: 'danger', onclick: lock('Resetting…', async () => { if (confirm('Remove demo data and load a fresh set?')) { await api('DELETE', '/api/demo'); await api('POST', '/api/demo/seed'); await loadStatus(); await render(); } }) }, 'Reset demo scenarios') : h('button', { class: 'primary', onclick: lock('Loading…', async () => { await api('POST', '/api/demo/seed'); await render(); }) }, 'Load demo scenarios'), sim('ai', 'AI'), sim('paypal', 'PayPal')));
}

async function viewApprovals() {
  const list = await api('GET', '/api/proposals');
  main.replaceChildren(h('h2', {}, 'Approvals'));
  if (!list.length) { main.append(h('div', { class: 'card empty' }, 'No approval requests yet. Open an invoice and ask the agent to propose an action.')); return; }
  const group = (title, f) => { const g = list.filter(f); if (g.length) main.append(h('h2', {}, title), ...g.map(proposalCard)); };
  group('Needs your decision', (p) => p.status === 'pending' || p.status === 'approved');
  group('In progress', (p) => p.status === 'executed');
  group('History', (p) => !['pending', 'approved', 'executed'].includes(p.status));
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
    issueDate: h('input', { type: 'date', required: true, value: existing ? existing.issueDate : t }), dueDate: h('input', { type: 'date', required: true, value: existing ? existing.dueDate : '' }),
    notes: h('textarea', { maxlength: 500, 'aria-label': 'Notes' }) };
  f.notes.value = existing && existing.notes ? existing.notes : '';
  const err = h('p', { class: 'err', role: 'alert' });
  const field = (label, el) => h('div', {}, h('label', {}, label), el);
  return h('form', { class: 'card', onsubmit: async (ev) => {
    ev.preventDefault(); err.textContent = '';
    try {
      const body = { client: f.client.value, number: f.number.value, amount: Number(f.amount.value), currency: f.currency.value.toUpperCase(), issueDate: f.issueDate.value, dueDate: f.dueDate.value, notes: f.notes.value };
      if (existing) await api('PUT', `/api/invoices/${existing.id}`, body); else await api('POST', '/api/invoices', body);
      toast(existing ? 'Invoice updated.' : 'Invoice added.'); onDone ? onDone() : render();
    } catch (e) { err.textContent = e.message; }
  } }, field('Client name', f.client), field('Invoice number', f.number),
  h('div', { class: 'grid2' }, field('Amount', f.amount), field('Currency', f.currency)),
  h('div', { class: 'grid2' }, field('Issue date', f.issueDate), field('Due date', f.dueDate)),
  field('Notes (untrusted text: never used for decisions)', f.notes), err,
  h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'submit' }, existing ? 'Save changes' : 'Add invoice')));
}

async function openDetail(id) { state.detail = id; await render(); main.focus(); window.scrollTo(0, 0); }

function strategist(inv, ev) {
  const el = ev.eligibility, rec = ev.recommendation;
  const out = h('div', {}, h('h2', {}, 'AI Recovery Strategist'));
  out.append(h('div', { class: 'card' }, h('div', { class: 'row' }, h('h3', {}, 'Verified facts'), h('span', { class: 'badge none' }, 'from your records')), h('ul', { class: 'facts' }, ev.facts.map(([k, v]) => h('li', {}, h('span', {}, k), h('span', {}, v))))));
  out.append(h('div', { class: 'card' }, h('div', { class: 'row' }, h('h3', {}, 'Rule-based conclusions'), h('span', { class: 'badge none' }, 'fixed rules, not AI')), h('ul', { class: 'list' }, ev.rules.map((r) => h('li', {}, r)))));
  out.append(h('div', { class: 'card glow' }, h('div', { class: 'row' }, h('h3', {}, 'Recommendation'), h('span', { class: 'badge ' + (rec.action === 'human_review' ? 'bad' : rec.action === 'send_reminder' ? 'warn' : 'ok') }, rec.action.replace('_', ' '))),
    h('p', {}, h('strong', {}, rec.headline)), h('p', { class: 'muted' }, rec.reason),
    h('details', {}, h('summary', {}, 'Evidence, risks and uncertainty'),
      h('p', { class: 'muted small' }, 'Evidence used'), h('ul', { class: 'list' }, rec.evidence.map((x) => h('li', {}, x))),
      rec.risks.length ? [h('p', { class: 'muted small' }, 'Risks'), h('ul', { class: 'list' }, rec.risks.map((x) => h('li', {}, x)))] : null,
      h('p', { class: 'muted small' }, 'Unknown or missing'), h('ul', { class: 'list' }, ev.uncertainty.map((x) => h('li', {}, x))),
      rec.wouldChangeIf.length ? [h('p', { class: 'muted small' }, 'This would change if'), h('ul', { class: 'list' }, rec.wouldChangeIf.map((x) => h('li', {}, x)))] : null)));
  const aiBox = h('div', {});
  out.append(h('div', { class: 'card' }, h('div', { class: 'row' }, h('h3', {}, 'AI interpretation'), h('span', { class: 'badge demo' }, 'AI commentary, not a fact')),
    h('p', { class: 'muted' }, 'Optional. Gemini explains the facts above in plain words. It cannot change the rules, the status or the approvals.'), aiBox,
    h('div', { class: 'actions' }, h('button', { onclick: lock('Asking Gemini…', async () => {
      const r = await api('POST', `/api/invoices/${inv.id}/interpret`);
      aiBox.replaceChildren(r.ok ? h('div', {}, h('div', { class: 'draft' }, r.text), h('p', { class: 'muted small' }, `Source: ${r.source}. AI wording can contain mistakes.`)) : h('p', { class: 'warnbox' }, `AI unavailable (${r.error}). The rule-based analysis above is unaffected.`));
      loadStatus();
    }) }, 'Ask Gemini to interpret'))));
  const acts = h('div', { class: 'card' }, h('h3', {}, 'Actions the agent may propose (allowlist)'));
  for (const [key, label] of [['send_reminder', 'Release a recovery reminder (draft only)'], ['start_checkout', 'Start PayPal Sandbox checkout']]) {
    acts.append(h('div', { class: 'sep' }), h('div', { class: 'row' }, h('span', { class: 'name' }, label), h('span', { class: 'badge ' + (el[key].allowed ? 'ok' : 'bad') }, el[key].allowed ? 'allowed' : 'blocked')), h('p', { class: el[key].allowed ? 'muted' : 'warnbox' }, el[key].reason),
      h('div', { class: 'actions' }, h('button', { class: el[key].allowed ? 'primary' : 'ghost', onclick: lock('Requesting…', async () => {
        try { await api('POST', `/api/invoices/${inv.id}/proposals`, { action: key }); toast('Approval requested. Review it below.'); }
        catch (e) { toast(e.status === 409 ? `Blocked: ${e.message}` : e.message); }
        await render(); await loadStatus();
      }) }, el[key].allowed ? 'Request approval' : 'Attempt anyway (will be blocked and logged)')));
  }
  out.append(acts);
  return out;
}

async function viewDetail() {
  const inv = await api('GET', `/api/invoices/${state.detail}`);
  const ev = await api('POST', `/api/invoices/${state.detail}/analyze`);
  const a = inv.assessment;
  main.replaceChildren(h('button', { class: 'back', onclick: () => { state.detail = null; render(); } }, '← Back'), h('h2', {}, inv.client));
  const card = h('div', { class: 'card' },
    h('div', { class: 'row' }, h('span', { class: 'name' }, `${inv.number} · ${money(inv.amount, inv.currency)}`), badge(a.level)),
    h('p', { class: 'muted' }, `Issued ${inv.issueDate} · Due ${inv.dueDate} · Status: ${inv.status}`), h('div', {}, inv.disputed && h('span', { class: 'badge bad' }, 'DISPUTED'), ' ', inv.demo && h('span', { class: 'badge demo' }, 'DEMO')),
    inv.disputed && inv.disputeNote && h('p', { class: 'warnbox' }, `Dispute note: ${inv.disputeNote}`),
    inv.notes && h('p', { class: 'muted small' }, `Notes (untrusted text, ignored by rules): ${inv.notes}`),
    ev.flags.injectionSuspected && h('p', { class: 'warnbox' }, 'These notes contain instruction-like text. PayPilot treats it as data, ignores it in every rule, and keeps it away from the AI.'));
  if (inv.status === 'open') card.append(h('div', { class: 'actions' },
    h('button', { onclick: lock('Saving…', async () => {
      if (inv.disputed) { await api('POST', `/api/invoices/${inv.id}/dispute`, { disputed: false }); } else { const note = prompt('Why is this invoice disputed? (optional)'); if (note === null) return; await api('POST', `/api/invoices/${inv.id}/dispute`, { disputed: true, note }); }
      await render(); await loadStatus();
    }) }, inv.disputed ? 'Clear dispute' : 'Mark as disputed'),
    h('button', { onclick: lock('Saving…', async () => { if (confirm('Mark as paid without a PayPal payment? It will be recorded as manual.')) { await api('POST', `/api/invoices/${inv.id}/mark-paid-manually`); await render(); } }) }, 'Mark paid manually'),
    h('button', { class: 'danger', onclick: lock('Saving…', async () => { await api('PUT', `/api/invoices/${inv.id}`, { status: 'void' }); await render(); }) }, 'Void')));
  main.append(card, strategist(inv, ev));

  main.append(h('h2', {}, 'Approval requests for this invoice'));
  if (!inv.proposals.length) main.append(h('div', { class: 'card empty' }, 'No approval requests yet.'));
  inv.proposals.forEach((p) => main.append(proposalCard(p)));

  const drafts = inv.drafts.slice().reverse();
  const manual = h('details', { class: 'card' }, h('summary', {}, 'Manual drafts (advanced)'), h('p', { class: 'muted small' }, 'Write and edit your own message with AI help. This is separate from the agent workflow above. PayPilot never sends it.'));
  if (inv.status === 'open' && !inv.disputed) manual.append(h('div', { class: 'actions' }, h('button', { onclick: lock('Drafting… (up to 40 seconds)', async () => {
    try { await api('POST', `/api/invoices/${inv.id}/drafts`, {}); }
    catch (e) { if (e.data && e.data.canForce && confirm(e.message + '\n\nDraft one anyway?')) await api('POST', `/api/invoices/${inv.id}/drafts`, { force: true }); else if (!(e.data && e.data.canForce)) throw e; }
    await render(); await loadStatus();
  }) }, 'Draft a message')));
  drafts.forEach((d) => manual.append(draftCard(d)));
  main.append(manual);
  main.append(h('details', { class: 'card' }, h('summary', {}, 'Edit invoice'), inv.status === 'paid' ? h('p', { class: 'muted' }, 'Paid invoices are locked.') : invoiceForm(inv, render)));
  main.append(h('h2', {}, 'Audit trail'), h('div', { class: 'card' }, timeline(inv.actions)));
}

function draftCard(d) {
  const card = h('div', { class: 'card' }, h('div', { class: 'row' }, h('span', { class: 'badge ' + (d.status === 'draft' ? 'medium' : d.status === 'discarded' ? 'none' : 'low') }, d.status === 'draft' ? 'draft: not approved' : d.status === 'approved' ? 'approved: not sent yet' : d.status === 'discarded' ? 'closed: invoice paid, void or disputed' : 'sent by you'), h('span', { class: 'muted small' }, d.source)));
  if (d.status === 'draft') {
    const ta = h('textarea', { maxlength: 2000, 'aria-label': 'Message text' }, d.text); ta.value = d.text;
    card.append(d.source.startsWith('AI:') ? h('p', { class: 'muted small' }, 'AI-written text can contain mistakes. Check every detail before approving.') : h('p', { class: 'muted small' }, 'This text comes from a fixed template, not AI.'), ta,
      h('div', { class: 'actions' }, h('button', { onclick: lock('Saving…', async () => { await api('PUT', `/api/drafts/${d.id}`, { text: ta.value }); toast('Draft saved.'); }) }, 'Save edits'),
        h('button', { class: 'primary', onclick: lock('Approving…', async () => { await api('PUT', `/api/drafts/${d.id}`, { text: ta.value }); await api('POST', `/api/drafts/${d.id}/approve`); await render(); }) }, 'Approve message')));
  } else {
    card.append(h('div', { class: 'draft' }, d.text));
    if (d.status === 'approved') card.append(h('p', { class: 'muted small' }, 'PayPilot does not send messages. Copy this, send it yourself, then confirm.'),
      h('div', { class: 'actions' }, h('button', { onclick: async () => { try { await navigator.clipboard.writeText(d.text); toast('Copied.'); } catch (_) { toast('Could not copy.'); } } }, 'Copy message'),
        h('button', { class: 'primary', onclick: lock('Saving…', async () => { await api('POST', `/api/drafts/${d.id}/sent`); await render(); }) }, 'I sent it')));
  }
  return card;
}

async function viewActivity() {
  const list = await api('GET', '/api/actions');
  main.replaceChildren(h('h2', {}, 'Recent activity'));
  main.append(list.length ? h('div', { class: 'card' }, timeline(list)) : h('div', { class: 'card empty' }, 'Nothing has happened yet.'));
}

async function render() {
  await safe(async () => {
    if (state.detail) return viewDetail();
    return ({ mission: viewMission, approvals: viewApprovals, invoices: viewInvoices, activity: viewActivity })[state.tab]();
  });
  refreshBadge();
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
