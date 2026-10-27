'use strict';
// Deterministic, explainable recovery prioritisation. No randomness, no ML.
// The score ranks WHICH invoice to chase first; it does not predict whether a client will pay.
const DAY = 86400000;

function parseDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}
// whole days from `from` to `to` (positive if `to` is later)
function daysBetween(from, to) { return Math.round((parseDate(to) - parseDate(from)) / DAY); }
function today(now = new Date()) { return now.toISOString().slice(0, 10); }

function validateInvoice(i) {
  const e = [];
  if (typeof i.client !== 'string' || !i.client.trim() || i.client.length > 100) e.push('Client name is required (max 100 characters).');
  if (typeof i.number !== 'string' || !i.number.trim() || i.number.length > 40) e.push('Invoice number is required (max 40 characters).');
  if (typeof i.amount !== 'number' || !Number.isFinite(i.amount) || i.amount <= 0 || i.amount > 1e7) e.push('Amount must be a number above 0.');
  if (typeof i.currency !== 'string' || !/^[A-Z]{3}$/.test(i.currency)) e.push('Currency must be a 3-letter code such as USD.');
  const iss = parseDate(i.issueDate), due = parseDate(i.dueDate);
  if (!iss) e.push('Issue date must be a valid date (YYYY-MM-DD).');
  if (!due) e.push('Due date must be a valid date (YYYY-MM-DD).');
  if (iss && due && due < iss) e.push('Due date cannot be before the issue date.');
  if (i.notes != null && (typeof i.notes !== 'string' || i.notes.length > 500)) e.push('Notes must be text under 500 characters.');
  return e;
}

function assess(inv, now = today()) {
  const out = { invoiceId: inv.id, overdueDays: 0, score: 0, level: 'none', action: 'none', tone: null, recommendation: '', reasons: [] };
  if (inv.status === 'paid') { out.recommendation = 'Paid. No action needed.'; out.reasons.push('Invoice is marked paid.'); return out; }
  if (inv.status === 'void') { out.recommendation = 'Void. No action needed.'; out.reasons.push('Invoice is void.'); return out; }

  const overdue = Math.max(0, daysBetween(inv.dueDate, now));
  const dueIn = daysBetween(now, inv.dueDate);
  out.overdueDays = overdue;
  const reminders = inv.reminderCount || 0;
  const since = inv.lastReminderAt ? daysBetween(inv.lastReminderAt, now) : null;

  const pOverdue = Math.round(Math.min(overdue, 60) / 60 * 50);
  const pAmount = Math.round(Math.min(Math.log10(inv.amount + 1) / 4, 1) * 25);
  const pRem = Math.min(reminders * 5, 15);
  const pSoon = overdue === 0 && dueIn <= 3 ? 10 : 0;
  out.score = Math.min(100, pOverdue + pAmount + pRem + pSoon);

  if (overdue > 0) out.reasons.push(`${overdue} day${overdue === 1 ? '' : 's'} past the due date of ${inv.dueDate} (+${pOverdue}, capped at 60 days).`);
  else out.reasons.push(dueIn === 0 ? 'Due today.' : `Due in ${dueIn} day${dueIn === 1 ? '' : 's'} (${inv.dueDate}).`);
  out.reasons.push(`Amount ${inv.amount.toFixed(2)} ${inv.currency} (+${pAmount}, larger amounts rank higher).`);
  if (reminders > 0) out.reasons.push(`${reminders} reminder${reminders === 1 ? '' : 's'} already sent, last on ${inv.lastReminderAt} (+${pRem}).`);
  else if (overdue > 0) out.reasons.push('No reminder has been sent yet.');
  if (pSoon) out.reasons.push(`Due within 3 days (+${pSoon}).`);

  out.level = out.score >= 55 ? 'high' : out.score >= 30 ? 'medium' : 'low';

  if (inv.disputed) {
    out.action = 'human_review'; out.level = 'medium';
    out.recommendation = 'Disputed: pause collection and review the dispute with the client.';
    out.reasons.push('The invoice is marked disputed, so automated collection is paused.');
    return out;
  }

  if (overdue === 0) {
    if (dueIn <= 3) { out.action = 'courtesy_reminder'; out.tone = 'courtesy'; out.recommendation = 'Optional: send a courtesy reminder before the due date.'; }
    else { out.action = 'wait_not_due'; out.recommendation = 'Not due yet. No action needed.'; }
    return out;
  }
  if (since !== null && since < 3) {
    out.action = 'wait_recent_reminder';
    out.recommendation = `Wait: a reminder was sent ${since} day${since === 1 ? '' : 's'} ago. Give the client time to respond.`;
    out.reasons.push('Recent reminder, so the app suggests waiting before chasing again.');
    out.level = 'low';
    return out;
  }
  if (overdue <= 7) { out.action = 'friendly_reminder'; out.tone = 'friendly'; out.recommendation = 'Send a friendly reminder.'; }
  else if (overdue <= 30) { out.action = 'firm_follow_up'; out.tone = 'firm'; out.recommendation = 'Send a firm follow-up.'; }
  else { out.action = 'final_notice'; out.tone = 'final'; out.recommendation = 'Send a final notice and consider calling the client.'; }
  return out;
}

function recoveryQueue(invoices, now = today()) {
  return invoices.map((inv) => ({ inv, a: assess(inv, now) }))
    .filter(({ inv, a }) => inv.status === 'open' && (a.overdueDays > 0 || a.action === 'courtesy_reminder'))
    .sort((x, y) => (x.a.action === 'wait_recent_reminder' || x.a.action === 'human_review') - (y.a.action === 'wait_recent_reminder' || y.a.action === 'human_review') || y.a.score - x.a.score || y.a.overdueDays - x.a.overdueDays || x.inv.id.localeCompare(y.inv.id))
    .map(({ a }) => a);
}

module.exports = { parseDate, daysBetween, today, validateInvoice, assess, recoveryQueue };
