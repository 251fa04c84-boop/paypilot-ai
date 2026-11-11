'use strict';
const main = document.getElementById('main');
const state = { tab: 'mission', detail: null, health: null, user: null };

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
  const res = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
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

// ---------- private account access ----------
const authPanel = document.getElementById('auth-panel');
const accountButton = document.getElementById('account-button');
function accountButtonState() {
  accountButton.textContent = state.user ? 'My account' : 'Sign in';
  accountButton.onclick = () => openAccountPanel(state.user ? 'account' : 'login');
}
async function loadAccount() {
  try {
    const result = await api('GET', '/api/auth/me');
    state.user = result.user || null;
  } catch (error) {
    state.user = null;
  }
  accountButtonState();
}
function openAccountPanel(mode = 'login') {
  const titles = {
    register: 'Create your private workspace',
    account: 'Your private workspace',
    forgot: 'Reset your password',
    reset: 'Choose a new password',
    login: 'Sign in to PayPilot'
  };
  const descriptions = {
    register: 'Create a separate workspace for your invoices. Use at least 12 characters for your password.',
    account: 'Your records are loaded from the tenant linked to your signed-in account.',
    forgot: 'Enter your account email. If an account exists, we will send a one-time reset link.',
    reset: 'Choose a new password with at least 12 characters. Reset links expire after 30 minutes.',
    login: 'Sign in to open your private invoices and activity.'
  };
  const close = h('button', { type: 'button', class: 'auth-link', onclick: () => { authPanel.hidden = true; } }, 'Close');
  const card = h('section', { class: 'auth-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'auth-title' },
    h('div', { class: 'auth-actions' }, h('span', { class: 'pill ok' }, state.user ? 'PRIVATE ACCOUNT' : 'ACCOUNT ACCESS'), close),
    h('h2', { id: 'auth-title' }, titles[mode] || titles.login),
    h('p', {}, descriptions[mode] || descriptions.login));
  if (mode === 'account' && state.user) {
    card.append(h('p', {}, 'Account ID: ' + state.user.id));
    card.append(h('button', { type: 'button', class: 'primary', onclick: async () => {
      try { await api('POST', '/api/auth/logout', {}); state.user = null; authPanel.hidden = true; accountButtonState(); toast('Signed out.'); location.reload(); }
      catch (error) { toast(error.message); }
    } }, 'Sign out'));
  } else {
    const email = mode === 'reset' ? null : h('input', { id: 'auth-email', name: 'email', type: 'email', autocomplete: 'username', required: true, maxlength: '254', placeholder: 'you@example.com' });
    const password = (mode === 'login' || mode === 'register' || mode === 'reset')
      ? h('input', { id: 'auth-password', name: 'password', type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: true, minlength: '12', maxlength: '128', placeholder: 'At least 12 characters' })
      : null;
    const confirm = mode === 'reset'
      ? h('input', { id: 'auth-confirm', name: 'confirm', type: 'password', autocomplete: 'new-password', required: true, minlength: '12', maxlength: '128', placeholder: 'Confirm new password' })
      : null;
    const form = h('form', { onsubmit: async (event) => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        if (mode === 'forgot') {
          await api('POST', '/api/auth/password/forgot', { email: email.value });
          toast('If an account exists for that email, a reset link will be sent.');
          return;
        }
        if (mode === 'reset') {
          if (password.value !== confirm.value) throw new Error('The passwords do not match.');
          const token = new URLSearchParams(location.search).get('reset_token') || '';
          await api('POST', '/api/auth/password/reset', { token, password: password.value });
          history.replaceState(null, '', location.pathname);
          authPanel.hidden = true;
          toast('Password updated. Please sign in again.');
          openAccountPanel('login');
          return;
        }
        await api('POST', mode === 'register' ? '/api/auth/register' : '/api/auth/login', { email: email.value, password: password.value });
        authPanel.hidden = true;
        await loadAccount();
        await loadStatus();
        await render();
        toast(mode === 'register' ? 'Private workspace created.' : 'Signed in to your private workspace.');
      } catch (error) {
        toast(error.message);
      } finally { submit.disabled = false; }
    } });
    if (email) { form.append(h('label', { for: 'auth-email' }, 'Email address'), email); }
    if (password) { form.append(h('label', { for: 'auth-password' }, mode === 'reset' ? 'New password' : 'Password'), password); }
    if (confirm) { form.append(h('label', { for: 'auth-confirm' }, 'Confirm new password'), confirm); }
    const submitLabel = mode === 'register' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Update password' : 'Sign in';
    form.append(h('button', { type: 'submit', class: 'primary' }, submitLabel));
    card.append(form);
    if (mode === 'login') {
      card.append(h('p', {}, h('button', { type: 'button', class: 'auth-link', onclick: () => openAccountPanel('forgot') }, 'Forgot password?')));
      card.append(h('p', {}, 'New to PayPilot? ', h('button', { type: 'button', class: 'auth-link', onclick: () => openAccountPanel('register') }, 'Create an account')));
    } else if (mode === 'register' || mode === 'forgot') {
      card.append(h('p', {}, 'Already have an account? ', h('button', { type: 'button', class: 'auth-link', onclick: () => openAccountPanel('login') }, 'Sign in')));
    }
  }
  authPanel.replaceChildren(card);
  authPanel.hidden = false;
  const first = authPanel.querySelector('input');
  if (first) first.focus();
}
accountButtonState();
if (new URLSearchParams(location.search).has('reset_token')) openAccountPanel('reset');

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
    accountButton.disabled = !hh.auth?.enabled;
    accountButton.textContent = hh.auth?.enabled ? (state.user ? 'My account' : 'Sign in') : 'Accounts unavailable';
    s.append(pill(hh.paypal.configured ? 'ok' : 'warn', hh.paypal.configured ? 'PayPal Sandbox: connected' : 'PayPal Sandbox: not configured'), aiPill(hh.ai), state.user ? pill('ok', 'Private workspace · isolated data') : pill('warn', 'Shared judge demo'));
    if (!hh.demo.publicMutationsEnabled) s.append(pill('warn', 'Read-only public preview · interactive actions disabled'));
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
  const timing = inv.status === 'paid'
    ? `Paid (${inv.paymentMethod === 'paypal_sandbox' ? 'PayPal Sandbox, verified' : inv.paymentMethod === 'manual' ? 'marked manually' : 'demo record'})`
    : a.overdueDays > 0 ? `${a.overdueDays} days overdue`
      : a.dueInDays === 0 ? 'Due today'
        : a.dueInDays === 1 ? 'Due tomorrow' : `Due in ${a.dueInDays} days`;
  const score = Math.max(0, Math.min(100, Number(a.score) || 0));
  const meter = h('div', {
    class: 'priority-meter',
    role: 'meter',
    'aria-label': `Explainable urgency score: ${score} out of 100; not a payment probability.`,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': score,
  }, Array.from({ length: 10 }, (_, index) => h('span', {
    class: index < Math.ceil(score / 10) ? 'filled' : '',
    'aria-hidden': 'true',
  })));
  return h('div', { class: 'card invoice-card invoice-card-' + a.level },
    h('div', { class: 'row invoice-card-heading' }, h('span', { class: 'name' }, inv.client), h('span', { class: 'badge ' + a.level, title: 'Explainable urgency score; not a payment probability.' }, `${a.level} priority · ${a.score}/100`)),
    h('div', { class: 'row invoice-card-meta' }, h('span', { class: 'muted' }, `${inv.number} · ${money(inv.amount, inv.currency)}`), h('span', { class: 'invoice-flags' }, inv.disputed && h('span', { class: 'badge bad' }, 'DISPUTED'), ' ', inv.demo && h('span', { class: 'badge demo' }, 'DEMO'))),
    meter,
    h('p', { class: 'muted invoice-timing' }, timing),
    h('p', { class: 'invoice-recommendation' }, a.recommendation),
    h('details', { class: 'score-explain' },
      h('summary', {}, 'Why this score?'),
      h('ul', { class: 'list' }, (Array.isArray(a.reasons) ? a.reasons : []).map((reason) => h('li', {}, reason)))),
    h('div', { class: 'actions invoice-actions' }, h('button', { class: 'primary', onclick: onOpen }, 'Open invoice')));
}
const tile = (label, value, cur, sub) => h('div', { class: 'tile' }, h('div', { class: 'muted small' }, label), h('div', { class: 'big' }, `${Number(value).toFixed(2)} ${cur}`), h('div', { class: 'muted small' }, sub));
const countTile = (label, value, sub) => h('div', { class: 'tile' }, h('div', { class: 'muted small' }, label), h('div', { class: 'big' }, String(Number(value) || 0)), h('div', { class: 'muted small' }, sub));
function totals(sum) {
  return sum.map((c) => h('div', { class: 'card glow' }, h('div', { class: 'row' }, h('span', { class: 'name' }, `Recovery metrics (${c.currency})`), h('span', { class: 'badge none' }, 'plain arithmetic, no AI')),
    h('div', { class: 'tiles' },
      tile('Outstanding', c.outstanding, c.currency, `${c.openCount} open`),
      tile('Overdue', c.overdue, c.currency, `${c.overdueCount} invoice${c.overdueCount === 1 ? '' : 's'}`),
      tile('At risk (30+ days late)', c.atRisk, c.currency, `${c.atRiskCount} invoice${c.atRiskCount === 1 ? '' : 's'}`),
      tile('Disputed (paused)', c.disputed, c.currency, `${c.disputedCount} invoice${c.disputedCount === 1 ? '' : 's'}`),
      tile('Paid via PayPal Sandbox', c.paidViaPayPal, c.currency, `${c.paidViaPayPalCount || 0} verified capture${c.paidViaPayPalCount === 1 ? '' : 's'}`),
      countTile('Operator-confirmed reminders', c.remindersConfirmed, 'User-confirmed; delivery not verified'))));
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

function agentLoop(status) {
  const steps = [
    { label: '1. Observe' },
    { label: '2. Analyze' },
    { label: '3. Plan' },
    { label: '4. Approve' },
    { label: '5. Execute' },
    { label: '6. Verify' },
    { label: '7. Audit' },
  ];
  let cur = 3;
  if (status === 'pending') cur = 3;
  else if (status === 'approved') cur = 4;
  else if (status === 'executed') cur = 5;
  else if (['verified', 'confirmed'].includes(status)) cur = 6;

  return h('div', { class: 'agent-loop', 'aria-label': 'Agent loop progress' },
    ...steps.flatMap((s, idx) => [
      h('span', { class: 'agent-step ' + (idx < cur ? 'done' : idx === cur ? 'active' : '') }, s.label),
      idx < steps.length - 1 && h('span', { class: 'agent-arrow' }, '→'),
    ]).filter(Boolean));
}

// ---------- approval review card ----------
function proposalCard(p) {
  const inv = p.invoice || { client: '?', number: '?', amount: 0, currency: '' };
  const live = p.status === 'pending' || p.status === 'approved';
  const card = h('div', { class: 'card ' + (p.status === 'pending' ? 'glow' : '') },
    agentLoop(p.status),
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
    const orderId = p.orderId || (p.result.approveUrl.match(/token=([A-Za-z0-9-]+)/) || [])[1];
    bar.append(
      h('a', { class: 'btn primary', href: p.result.approveUrl, target: '_blank', rel: 'noopener' }, 'Open PayPal Sandbox checkout'),
      state.health && state.health.demo.adminControlsEnabled && orderId && h('button', { class: 'btn', onclick: lock('Simulating webhook capture…', async () => {
        const sim = await api('POST', '/api/demo/simulate-webhook', { orderId });
        toast(sim.result && sim.result.outcome === 'paid' ? 'Payment capture verified with PayPal!' : 'Webhook simulated.');
        await finish();
      }) }, '⚡ Simulate Webhook Settlement (Demo)'),
      h('span', { class: 'muted small' }, 'Not paid yet. When PayPal confirms capture, the server verifies the settlement.')
    );
  }
  if (bar.children.length) card.append(bar);
  return card;
}

// ---------- views ----------
async function viewMission() {
  // Keep the overview useful when a secondary endpoint is unavailable.
  // Previously Promise.all made one failed proposals request blank the entire page.
  const errors = [];
  const [qResult, allResult, proposalsResult] = await Promise.allSettled([
    api('GET', '/api/recovery'),
    api('GET', '/api/invoices'),
    api('GET', '/api/proposals?open=1'),
  ]);
  const q = qResult.status === 'fulfilled' && Array.isArray(qResult.value) ? qResult.value : [];
  const all = allResult.status === 'fulfilled' && Array.isArray(allResult.value) ? allResult.value : [];
  const open = proposalsResult.status === 'fulfilled' && Array.isArray(proposalsResult.value) ? proposalsResult.value : [];
  if (qResult.status === 'rejected') errors.push('Recovery queue could not load: ' + qResult.reason.message);
  if (allResult.status === 'rejected') errors.push('Invoices could not load: ' + allResult.reason.message);
  if (proposalsResult.status === 'rejected') errors.push('Approval count could not load: ' + proposalsResult.reason.message);
  let sum = [];
  if (all.length) {
    try {
      const summary = await api('GET', '/api/summary');
      if (Array.isArray(summary)) sum = summary;
      else if (summary && typeof summary === 'object' && summary.currency) sum = [summary];
      else throw new Error('Unexpected summary response format');
    } catch (e) { errors.push('Financial summary could not load: ' + e.message); }
  }
  const waiting = open.filter((p) => p.status === 'pending' || p.status === 'approved');
  // Count every overdue open invoice, including disputed ones; disputes are excluded from the active queue but remain part of total exposure.
  const overdueCount = sum.reduce((total, currency) => total + currency.overdueCount, 0);
  const disputedCount = all.filter((i) => i.status === 'open' && i.disputed).length;
  const openCount = all.filter((i) => i.status === 'open').length;
  main.replaceChildren(
    errors.length ? h('section', { class: 'card warnbox', role: 'status' },
      h('strong', {}, 'Some overview data is unavailable'),
      h('ul', { class: 'list' }, errors.map((message) => h('li', {}, message))),
      h('p', { class: 'muted small' }, 'The rest of the workspace remains available. Try refreshing, or open Invoices and Approvals directly.')
    ) : null,
    h('section', { class: 'mission-hero' },
      h('div', { class: 'hero-copy' },
        h('div', { class: 'eyebrow' }, 'RECEIVABLES / DAILY WORKSPACE'),
        h('h2', {}, 'See what is overdue. Decide what happens next.'),
        h('p', {}, 'A practical view of unpaid work, the reasons behind each recommendation, and the next decision waiting for you.'),
        h('div', { class: 'hero-tags' }, pill('ok', 'Rules-led decisions'), pill('warn', 'Human approval required'), pill('none', 'Sandbox payments only'))),
      h('div', { class: 'hero-mark', 'aria-hidden': 'true' }, h('span', { class: 'hero-orbit orbit-one' }), h('span', { class: 'hero-orbit orbit-two' }), h('span', { class: 'hero-core' }, 'P'))),
    h('section', { class: 'command-strip' },
      h('div', { class: 'command-stat' }, h('span', { class: 'stat-label' }, 'Open invoices'), h('strong', {}, String(openCount)), h('span', { class: 'stat-note' }, 'Across your portfolio')),
      h('div', { class: 'command-stat' }, h('span', { class: 'stat-label' }, 'Overdue invoices'), h('strong', {}, String(overdueCount)), h('span', { class: 'stat-note' }, 'Past their due date')),
      h('div', { class: 'command-stat' }, h('span', { class: 'stat-label' }, 'Awaiting review'), h('strong', {}, String(waiting.length)), h('span', { class: 'stat-note' }, 'Human decision required')),
      h('div', { class: 'command-stat' }, h('span', { class: 'stat-label' }, 'Paused disputes'), h('strong', {}, String(disputedCount)), h('span', { class: 'stat-note' }, 'Collection safely held'))));
  main.append(h('section', { class: 'judge-quickstart card glow' },
    h('div', { class: 'row' }, h('div', {}, h('div', { class: 'eyebrow' }, 'JUDGE QUICK START'), h('h3', {}, 'Evaluate the complete recovery workflow')), h('span', { class: 'badge cyan' }, '3-minute tour')),
    h('ol', { class: 'list judge-steps' },
      h('li', {}, h('strong', {}, 'Start with portfolio evidence. '), 'Compare the currency-grouped exposure with the urgency queue. Scores are explainable heuristics, not payment predictions.'),
      h('li', {}, h('strong', {}, 'Challenge the agent. '), 'Inspect a disputed invoice and an overdue invoice. Separate recorded facts, fixed rules, uncertainty and optional Gemini commentary.'),
      h('li', {}, h('strong', {}, 'Test controlled autonomy. '), 'Optionally run the portfolio sweep, inspect the exact approval, and verify that no action executes without human approval. Sandbox checkout is test money only.')),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => { const target = all.find((i) => i.client === 'Harbor Dental' || i.number === 'D-1007'); if (target) openDetail(target.id); else switchTab('invoices'); } }, 'Inspect dispute scenario'),
      h('button', { class: 'btn', onclick: () => switchTab('assistant') }, 'Try AI assistant'),
      h('button', { class: 'btn', onclick: () => switchTab('approvals') }, 'Open approvals')),
    h('p', { class: 'muted small' }, 'Demo records are shared and may reset. Do not enter real customer data. Running a sweep changes the shared demo state; do it only when you want to test the workflow.')));
  if (waiting.length) main.append(h('div', { class: 'review-banner' },
    h('div', {}, h('strong', {}, `${waiting.length} decision${waiting.length === 1 ? '' : 's'} need your attention`), h('p', {}, 'Nothing in this queue executes without your approval.')),
    h('button', { class: 'primary', onclick: () => switchTab('approvals') }, 'Review approvals')));
  if (all.length > 0) {
    main.append(h('section', { class: 'autopilot-panel' },
      h('div', { class: 'autopilot-heading' }, h('div', {}, h('div', { class: 'eyebrow' }, 'CONTROLLED AUTONOMY'), h('h3', {}, 'Portfolio review')),
        h('span', { class: 'badge ok' }, 'Observe · analyse · propose')),
      h('p', { class: 'muted' }, 'Review every open invoice against the same published rules. Eligible next steps are prepared for your approval; disputed and recently contacted accounts are held back.'),
      h('div', { class: 'actions' },
        h('button', { class: 'primary', onclick: lock('Scanning portfolio…', async () => {
          const r = await api('POST', '/api/agent/triage/apply');
          toast(`Autopilot sweep finished: ${r.count} recovery proposal(s) staged.`);
          await render();
          if (r.count > 0) switchTab('approvals');
        }) }, 'Run portfolio sweep'),
        h('span', { class: 'muted small' }, 'No silent sending · No AI-controlled payment status'))));
  }
  main.append(h('section', { class: 'portfolio-section' },
    h('div', { class: 'section-heading' }, h('div', {}, h('div', { class: 'eyebrow' }, 'FINANCIAL SNAPSHOT'), h('h3', {}, 'Portfolio exposure')), h('span', { class: 'muted small' }, 'Grouped by currency · deterministic totals')),
    ...totals(sum)));
  main.append(h('section', { class: 'priority-section' },
    h('div', { class: 'section-heading' }, h('div', {}, h('div', { class: 'eyebrow' }, 'NEXT BEST ACTIONS'), h('h3', {}, 'Recovery priority queue')),
      h('span', { class: 'badge warn' }, `${q.length} to review`))));
  if (!all.length) main.append(h('div', { class: 'card empty' }, h('p', {}, 'Your workspace is empty. Load the labelled demo scenarios to explore the workflow, or add your first invoice.'), h('div', { class: 'actions center' }, h('button', { class: 'primary', onclick: lock('Loading…', async () => { await api('POST', '/api/demo/seed'); await render(); }) }, 'Load demo scenarios'), h('button', { onclick: () => switchTab('invoices') }, 'Add an invoice'))));
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
      h('li', {}, 'Scenario 5, webhook: simulate an asynchronous PayPal webhook payment confirmation without redirect.'),
      h('li', {}, 'Injection test: Injection Test has hostile text in its notes. The agent treats it as data.')),
    h('div', { class: 'actions' },
      hasDemo
        ? (hh.demo.adminControlsEnabled ? h('button', { class: 'danger', onclick: lock('Resetting…', async () => { if (confirm('Remove demo data and load a fresh set?')) { await api('DELETE', '/api/demo'); await api('POST', '/api/demo/seed'); await loadStatus(); await render(); } }) }, 'Reset demo scenarios') : h('span', { class: 'muted small' }, 'Shared demo reset is disabled on this public deployment.'))
        : h('button', { class: 'primary', onclick: lock('Loading…', async () => { await api('POST', '/api/demo/seed'); await render(); }) }, 'Load demo scenarios'),
      hh.demo.adminControlsEnabled ? [sim('ai', 'AI'), sim('paypal', 'PayPal')] : [],
      h('button', { onclick: lock('Simulating webhook…', async () => {
        const invs = await api('GET', '/api/invoices');
        const target = invs.find((i) => i.status === 'open' && !i.disputed) || invs[0];
        if (!target) return toast('No open invoice available.');
        const checkout = await api('POST', `/api/invoices/${target.id}/pay`);
        const orderId = (checkout.approveUrl.match(/token=([A-Za-z0-9-]+)/) || [])[1];
        if (!orderId) return toast('Could not obtain order id.');
        await api('POST', '/api/demo/simulate-webhook', { orderId });
        toast(`Webhook received: payment verified for ${target.client}!`);
        state.detail = target.id;
        await render();
      }) }, 'Simulate PayPal Webhook Payment')));
}

async function viewApprovals() {
  const list = await api('GET', '/api/proposals');
  main.replaceChildren(h('h2', {}, 'Approvals'));
  if (!list.length) { main.append(h('div', { class: 'card empty' }, 'No approval requests yet. Open an invoice or run Autopilot Sweep to propose actions.')); return; }
  const waiting = list.filter((p) => p.status === 'pending');
  if (waiting.length > 1) {
    main.append(h('div', { class: 'card glow', style: 'margin-bottom:14px' },
      h('div', { class: 'row' }, h('span', { class: 'name' }, `Batch Operations (${waiting.length} pending)`), h('span', { class: 'badge warn' }, 'human approval')),
      h('p', { class: 'muted small' }, 'Review the proposals below. You can approve and execute all eligible actions in one click, or review each individually.'),
      h('div', { class: 'actions' },
        h('button', { class: 'primary', onclick: lock('Approving all…', async () => {
          const r = await api('POST', '/api/agent/proposals/batch-decision', { decision: 'approve', executeNow: true });
          toast(`Batch approved and executed ${r.processed} proposal(s).`);
          await render();
        }) }, `Approve & Run All (${waiting.length})`),
        h('button', { class: 'danger', onclick: lock('Rejecting all…', async () => {
          const r = await api('POST', '/api/agent/proposals/batch-decision', { decision: 'reject' });
          toast(`Rejected ${r.processed} proposal(s).`);
          await render();
        }) }, 'Reject All'))));
  }
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

const assistantHistory = [
  { sender: 'assistant', text: 'Hello. I can help you review overdue accounts, payment status and disputes. I will show the available evidence, and any recovery action still needs your approval.', source: 'system' },
];

async function viewAssistant() {
  main.replaceChildren(h('h2', {}, 'Ask about your receivables'),
    h('p', { class: 'muted' }, 'Ask a question about the invoice records. Answers use the available workspace data; actions still require your approval.'));

  const thread = h('div', { class: 'chat-thread' });
  const renderThread = () => {
    thread.replaceChildren(...assistantHistory.map((m) =>
      h('div', { class: 'chat-msg ' + m.sender },
        h('div', { style: 'font-size:.76rem;margin-bottom:4px;opacity:.75' }, m.sender === 'user' ? 'You' : `PayPilot AI (${m.source || 'verified'})`),
        h('div', { style: 'white-space:pre-wrap' }, m.text))));
    thread.scrollTop = thread.scrollHeight;
  };

  const ask = async (q) => {
    if (!q || !q.trim()) return;
    assistantHistory.push({ sender: 'user', text: q });
    renderThread();
    try {
      const res = await api('POST', '/api/assistant/chat', { query: q });
      assistantHistory.push({ sender: 'assistant', text: res.text, source: res.source });
    } catch (e) {
      assistantHistory.push({ sender: 'assistant', text: `Error: ${e.message}`, source: 'error' });
    }
    renderThread();
  };

  const input = h('input', { placeholder: 'Ask a question (e.g. "Who should I chase today?")', 'aria-label': 'Assistant question' });
  const form = h('form', { onsubmit: async (ev) => { ev.preventDefault(); const q = input.value; input.value = ''; await ask(q); } },
    h('div', { class: 'grid2', style: 'grid-template-columns:1fr auto;gap:8px;align-items:center' },
      input,
      h('button', { class: 'primary', type: 'submit' }, 'Ask')));

  const quickPills = h('div', { class: 'quick-pills' },
    h('button', { class: 'btn-pill', onclick: () => ask('What is our total outstanding and overdue amount?') }, 'Total overdue'),
    h('button', { class: 'btn-pill', onclick: () => ask('Who should I chase today?') }, "Today's priorities"),
    h('button', { class: 'btn-pill', onclick: () => ask('Show disputed invoices') }, 'Disputed invoices'),
    h('button', { class: 'btn-pill', onclick: () => ask('Status of Northwind Cafe') }, 'Northwind Cafe'),
    h('button', { class: 'btn-pill', onclick: () => ask('Status of Harbor Dental') }, 'Harbor Dental'));

  renderThread();
  main.append(quickPills, thread, form);
}

async function viewReconciliation() {
  main.replaceChildren(
    h('h2', {}, 'Payment reconciliation'),
    h('p', { class: 'muted' }, 'Paste a PayPal transaction CSV export to compare invoice references, amounts and currencies against this workspace. This is a read-only preview. It never marks invoices paid or changes payment records.'),
  );
  const csv = h('textarea', { rows: '9', maxlength: '100000', 'aria-label': 'Payment CSV', placeholder: 'Invoice Number,Amount,Currency,Transaction ID,Status\nINV-1001,125.00,USD,CAPTURE-123,COMPLETED' });
  const fileInput = h('input', { type: 'file', accept: '.csv,text/csv', 'aria-label': 'Choose a CSV file', onchange: async (event) => { const file = event.target.files && event.target.files[0]; if (!file) return; if (file.size > 80000) { error.textContent = 'CSV is too large. Maximum size is 80 KB.'; return; } try { csv.value = await file.text(); error.textContent = ''; } catch (_) { error.textContent = 'Could not read this file. Paste CSV text instead.'; } } });
  const error = h('p', { class: 'err', role: 'alert' });
  const output = h('div', {});
  const example = 'Invoice Number,Amount,Currency,Transaction ID,Status\nINV-1001,125.00,USD,CAPTURE-123,COMPLETED';
  const run = h('button', { class: 'primary', type: 'button', onclick: lock('Checking…', async () => {
    error.textContent = ''; output.replaceChildren();
    try {
      const result = await api('POST', '/api/reconciliation/preview', { csv: csv.value });
      const rows = result.results || [];
      const counts = rows.reduce((acc, item) => { acc[item.result] = (acc[item.result] || 0) + 1; return acc; }, {});
      const labels = { candidate: 'Review candidates', mismatch: 'Amount / currency mismatches', disputed: 'Disputed — paused', already_paid: 'Already marked paid', unmatched: 'Unmatched invoices', ambiguous: 'Ambiguous references', duplicate: 'Duplicate transaction IDs', not_completed: 'Not completed', status_missing: 'Status missing', invalid: 'Invalid rows' };
      output.append(h('div', { class: 'card glow' },
        h('div', { class: 'row' }, h('strong', {}, 'Preview results'), h('span', { class: 'badge none' }, 'No records changed')),
        h('p', { class: 'muted small' }, `${rows.length} transaction rows reviewed`),
        h('div', { class: 'tiles' }, Object.entries(labels).filter(([key]) => counts[key]).map(([key, label]) => h('div', { class: 'tile' }, h('div', { class: 'muted small' }, label), h('div', { class: 'big' }, String(counts[key])))))));
      rows.forEach((item) => {
        const label = labels[item.result] || item.result;
        output.append(h('div', { class: 'card' },
          h('div', { class: 'row' }, h('strong', {}, item.invoiceNumber || 'Missing invoice reference'), h('span', { class: 'badge ' + (item.result === 'candidate' ? 'ok' : item.result === 'mismatch' || item.result === 'disputed' ? 'warn' : 'none') }, label)),
          h('p', { class: 'muted small' }, `Row ${item.row} · ${item.amount == null ? 'Invalid amount' : money(item.amount, item.currency)}${item.transactionId ? ' · ' + item.transactionId : ''}`),
          h('p', {}, item.reason),
          item.client && h('p', { class: 'muted small' }, 'Workspace client: ' + item.client)));
      });
      if (!rows.length) output.append(h('div', { class: 'card empty' }, 'No transaction rows found.'));
    } catch (e) { error.textContent = e.message; }
  }) }, 'Preview reconciliation');
  const sample = h('button', { class: 'btn', type: 'button', onclick: () => { csv.value = example; error.textContent = ''; } }, 'Load sample CSV');
  main.append(h('section', { class: 'card' },
    h('div', { class: 'row' }, h('strong', {}, 'Import transaction evidence'), h('span', { class: 'badge none' }, 'CSV · max 250 rows')),
    h('p', { class: 'muted small' }, 'Required columns: Invoice Number, Amount, Currency. Optional: Transaction ID and Status. Rows without a completed provider status remain unverified and cannot become review candidates.'),
    h('label', {}, 'Choose CSV file (optional)'), fileInput,
    h('label', {}, 'Or paste CSV content'),
    csv,
    h('div', { class: 'actions' }, sample, run),
    error));
  main.append(output);
}

async function viewRisk() {
  const report = await api('GET', '/api/risk/portfolio');
  main.replaceChildren(
    h('h2', {}, 'Risk intelligence'),
    h('p', { class: 'muted' }, 'Deterministic review signals surface unusual patterns across open invoices. Scores prioritize human review; they are not fraud probabilities, credit scores or payment predictions.'),
    h('section', { class: 'tiles' },
      h('div', { class: 'tile' }, h('div', { class: 'muted small' }, 'Open invoices'), h('div', { class: 'big' }, String(report.totalOpen))),
      h('div', { class: 'tile' }, h('div', { class: 'muted small' }, 'Flagged for review'), h('div', { class: 'big' }, String(report.flagged))),
      h('div', { class: 'tile' }, h('div', { class: 'muted small' }, 'Critical / high'), h('div', { class: 'big' }, String(report.counts.critical + report.counts.high))),
      h('div', { class: 'tile' }, h('div', { class: 'muted small' }, 'Medium / low'), h('div', { class: 'big' }, String(report.counts.medium + report.counts.low)))),
    h('section', { class: 'card glow' }, h('strong', {}, 'Evidence-first risk radar'), h('p', { class: 'muted small' }, report.disclaimer),
      h('p', { class: 'muted small' }, 'Signals: disputes, severe overdue balances, duplicate invoice references, repeated recent reminders, same-client amount outliers and multiple active payment orders. No invoice or payment record is changed.'))
  );
  if (!report.items.length) { main.append(h('div', { class: 'card empty' }, 'No open invoices to review.')); return; }
  report.items.forEach((item) => {
    const cls = item.level === 'critical' || item.level === 'high' ? 'bad' : item.level === 'medium' ? 'warn' : 'ok';
    const card = h('section', { class: 'card' },
      h('div', { class: 'row' }, h('div', {}, h('strong', {}, item.client), h('p', { class: 'muted small' }, item.invoiceNumber + ' · ' + money(item.amount, item.currency))), h('span', { class: 'badge ' + cls }, item.level + ' · ' + item.score + '/100')),
      h('p', { class: 'muted small' }, item.disposition));
    if (!item.signals.length) card.append(h('p', { class: 'muted small' }, 'No configured risk signals detected.'));
    item.signals.forEach((signal) => card.append(h('div', { class: 'sep' }), h('div', { class: 'row' }, h('strong', {}, signal.title), h('span', { class: 'badge ' + (signal.severity === 'high' ? 'bad' : 'warn') }, '+' + signal.points)), h('p', { class: 'muted small' }, signal.evidence)));
    card.append(h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => openDetail(item.invoiceId) }, 'Inspect invoice')));
    main.append(card);
  });
}

async function viewCommandCentre() {
  const [overview, invoices, health] = await Promise.all([
    api('GET', '/api/intelligence/overview'), api('GET', '/api/invoices'), api('GET', '/api/health')
  ]);
  const risk = overview.risk, anomalies = overview.anomalies;
  main.replaceChildren(
    h('h2', {}, 'PayPilot command centre'),
    h('p', { class: 'muted' }, 'A judge-ready, evidence-first walkthrough: detect risk, inspect payment anomalies, simulate a recovery decision, then verify the audit and trust boundaries. All intelligence and simulations on this page are read-only.'),
    h('section', { class: 'tiles' },
      h('div', { class: 'tile' }, h('div', { class: 'muted small' }, 'Open invoices'), h('div', { class: 'big' }, String(risk.totalOpen))),
      h('div', { class: 'tile' }, h('div', { class: 'muted small' }, 'Risk flags'), h('div', { class: 'big' }, String(risk.flagged))),
      h('div', { class: 'tile' }, h('div', { class: 'muted small' }, 'Payment anomalies'), h('div', { class: 'big' }, String(anomalies.anomalyCount))),
      h('div', { class: 'tile' }, h('div', { class: 'muted small' }, 'Pending approvals'), h('div', { class: 'big' }, String(health.demo.publicMutationsEnabled ? 'Enabled' : 'Restricted')))),
    h('section', { class: 'card glow' }, h('strong', {}, '1 · Portfolio intelligence'),
      h('p', { class: 'muted small' }, risk.disclaimer),
      h('div', { class: 'row' }, h('span', {}, 'Critical ' + risk.counts.critical), h('span', {}, 'High ' + risk.counts.high), h('span', {}, 'Medium ' + risk.counts.medium), h('span', {}, 'Low ' + risk.counts.low)),
      h('button', { class: 'btn', onclick: () => switchTab('risk') }, 'Open Risk Radar')),
    h('section', { class: 'card' }, h('strong', {}, '2 · Payment anomaly monitor'),
      h('p', { class: 'muted small' }, anomalies.disclaimer),
      anomalies.anomalies.length ? anomalies.anomalies.slice(0, 8).map((x) => h('div', { class: 'sep' },
        h('div', { class: 'row' }, h('strong', {}, x.code.replace(/_/g, ' ')), pill(x.severity === 'critical' ? 'bad' : 'warn', x.severity)),
        h('p', { class: 'muted small' }, (x.invoiceNumber ? x.invoiceNumber + ': ' : '') + x.evidence))) : h('p', { class: 'muted' }, 'No payment-ledger anomalies detected in the current demo records.')),
    h('section', { class: 'card' }, h('strong', {}, '3 · Recovery what-if simulator'),
      h('p', { class: 'muted small' }, 'Select a synthetic or workspace invoice and preview the policy outcome. This does not create a draft, checkout, approval, proposal or audit event.'),
    ));
  const selector = h('select', { 'aria-label': 'Choose invoice' }, ...invoices.map((inv) => h('option', { value: inv.id }, inv.number + ' · ' + inv.client + ' · ' + inv.status)));
  const action = h('select', { 'aria-label': 'Choose recovery action' },
    h('option', { value: 'draft_reminder' }, 'Prepare reminder draft'),
    h('option', { value: 'create_checkout' }, 'Create PayPal Sandbox checkout'));
  const result = h('div', { class: 'muted small', role: 'status' }, 'Choose an invoice and action, then run the simulation.');
  const run = h('button', { class: 'primary', onclick: async () => {
    if (!selector.value) { result.textContent = 'No invoice is available to simulate.'; return; }
    try {
      const simulation = await api('GET', '/api/recovery/simulate?invoiceId=' + encodeURIComponent(selector.value) + '&action=' + encodeURIComponent(action.value));
      result.replaceChildren(
        h('div', { class: 'row' }, h('strong', {}, simulation.status === 'blocked' ? 'Blocked by policy' : 'Eligible for human review'), pill(simulation.status === 'blocked' ? 'bad' : 'ok', simulation.status)),
        h('p', {}, simulation.reason),
        h('ul', { class: 'list' }, simulation.steps.map((step) => h('li', {}, step))),
        h('p', { class: 'muted small' }, 'Simulation only · changes: ' + simulation.changes.length));
    } catch (e) { result.textContent = 'Simulation unavailable: ' + e.message; }
  } }, 'Run safe simulation');
  main.append(h('section', { class: 'card' }, h('div', { class: 'grid2' }, selector, action), h('div', { class: 'actions' }, run), result));
  main.append(h('section', { class: 'card' }, h('strong', {}, '4 · Trust and verification'),
    h('p', { class: 'muted small' }, 'Inspect explicit security controls, integration configuration and known gaps.'),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => switchTab('trust') }, 'Open Trust Centre')),
    h('p', { class: 'muted small' }, 'PayPal environment: ' + health.paypal.environment + ' · Storage: ' + health.storage)));
}

async function viewTrustCentre() {
  const trust = await api('GET', '/api/trust');
  const c = trust.controls;
  const rows = [
    ['PayPal Sandbox only', trust.environment],
    ['Tenant-scoped PostgreSQL', c.tenantScopedStorage],
    ['Signed private sessions', c.signedSessions],
    ['Human approval gate', c.humanApproval],
    ['Server-side capture verification', c.serverSideCaptureVerification],
    ['Signed webhook configured', c.webhookConfigured],
    ['Audit log', c.auditLog],
    ['Optional AI configured', c.aiConfigured],
    ['Email provider configured', c.emailConfigured],
    ['Public demo mutations', c.publicDemoMutations],
  ];
  main.replaceChildren(h('h2', {}, 'Trust centre'),
    h('p', { class: 'muted' }, 'A transparent control inventory. This endpoint exposes configuration status only; it never returns credentials, tokens or secret values.'),
    h('section', { class: 'card glow' }, h('strong', {}, 'Environment'), h('p', {}, trust.environment), h('p', { class: 'muted small' }, trust.storage)),
    h('section', { class: 'card' }, h('strong', {}, 'Security and integration controls'),
      ...rows.map(([label, value]) => h('div', { class: 'sep row' }, h('span', {}, label), pill(value === true ? 'ok' : value === false ? 'warn' : 'none', typeof value === 'boolean' ? (value ? 'Configured' : 'Not configured') : value)))),
    h('section', { class: 'card' }, h('strong', {}, 'Enforced boundaries'), h('ul', { class: 'list' }, trust.boundaries.map((x) => h('li', {}, x)))),
    h('section', { class: 'card warnbox' }, h('strong', {}, 'Known configuration gaps'),
      trust.caveats.length ? h('ul', { class: 'list' }, trust.caveats.map((x) => h('li', {}, x))) : h('p', {}, 'No known configuration gaps reported by this environment.')));
}

async function viewActivity() {
  const list = await api('GET', '/api/actions');
  const bar = h('div', { class: 'actions', style: 'margin-bottom:12px' },
    h('a', { class: 'btn', href: '/api/actions/export?format=csv', download: 'paypilot-audit.csv' }, 'Export Audit Log (CSV)'),
    h('a', { class: 'btn', href: '/api/actions/export?format=json', target: '_blank' }, 'Export (JSON)'));
  main.replaceChildren(h('div', { class: 'row' }, h('h2', {}, 'Recent activity'), bar));
  main.append(list.length ? h('div', { class: 'card' }, timeline(list)) : h('div', { class: 'card empty' }, 'Nothing has happened yet.'));
}

async function render() {
  await safe(async () => {
    if (state.detail) return viewDetail();
    return ({ mission: viewMission, approvals: viewApprovals, invoices: viewInvoices, reconcile: viewReconciliation, risk: viewRisk, command: viewCommandCentre, trust: viewTrustCentre, assistant: viewAssistant, activity: viewActivity })[state.tab]();
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
  await loadAccount();
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
