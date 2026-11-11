'use strict';

// Deterministic, explainable portfolio risk signals. This module never predicts fraud
// and never changes invoice/payment state. Every score is a review-priority heuristic.
const DAY = 86400000;
const daysBetween = (from, to) => {
  const a = Date.parse(String(from || '') + 'T00:00:00Z');
  const b = Date.parse(String(to || '') + 'T00:00:00Z');
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / DAY) : null;
};
const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
};

function assessPortfolioRisk(invoices, orders = [], today = new Date().toISOString().slice(0, 10)) {
  const open = invoices.filter((i) => i.status === 'open');
  const byNumber = new Map();
  const byClientCurrency = new Map();
  for (const inv of open) {
    const number = String(inv.number || '').trim().toLowerCase();
    if (!byNumber.has(number)) byNumber.set(number, []);
    byNumber.get(number).push(inv);
    const key = String(inv.client || '').trim().toLowerCase() + '|' + inv.currency;
    if (!byClientCurrency.has(key)) byClientCurrency.set(key, []);
    byClientCurrency.get(key).push(inv.amount);
  }
  const rows = open.map((inv) => {
    const signals = [];
    let score = 0;
    const add = (code, points, title, evidence, severity = 'medium') => {
      score += points;
      signals.push({ code, points, title, evidence, severity });
    };
    const overdue = Math.max(0, daysBetween(inv.dueDate, today) ?? 0);
    if (inv.disputed) add('dispute_open', 35, 'Active dispute', 'Collection must remain paused until a person resolves the dispute.', 'high');
    if (overdue >= 60) add('severely_overdue', 30, 'Severely overdue', `Invoice is ${overdue} days past due.`, 'high');
    else if (overdue >= 30) add('long_overdue', 20, 'Long overdue', `Invoice is ${overdue} days past due.`, 'high');
    else if (overdue >= 8) add('overdue', 10, 'Overdue', `Invoice is ${overdue} days past due.`);
    const duplicate = byNumber.get(String(inv.number || '').trim().toLowerCase()) || [];
    if (duplicate.length > 1) add('duplicate_invoice_number', 30, 'Duplicate invoice reference', `${duplicate.length} open invoices share reference ${inv.number}; verify before collecting.`, 'high');
    const recentDays = inv.lastReminderAt ? daysBetween(inv.lastReminderAt, today) : null;
    if ((inv.reminderCount || 0) >= 3 && recentDays !== null && recentDays >= 0 && recentDays <= 7) {
      add('contact_pressure', 15, 'Repeated recent reminders', `${inv.reminderCount} reminders are recorded and the last was ${recentDays} day(s) ago; review client contact history.`);
    }
    const clientKey = String(inv.client || '').trim().toLowerCase() + '|' + inv.currency;
    const peerAmounts = (byClientCurrency.get(clientKey) || []).filter((n) => n !== inv.amount);
    const baseline = median(peerAmounts);
    if (baseline !== null && baseline > 0 && inv.amount >= baseline * 3 && inv.amount - baseline >= 250) {
      add('amount_outlier', 15, 'Unusual invoice amount', `Amount ${inv.amount.toFixed(2)} ${inv.currency} is at least 3× the same-client median ${baseline.toFixed(2)} ${inv.currency}; confirm the invoice is correct.`);
    }
    const activeOrders = orders.filter((o) => o.invoiceId === inv.id && ['created', 'approved', 'PENDING'].includes(o.status));
    if (activeOrders.length > 1) add('multiple_open_orders', 25, 'Multiple open payment orders', `${activeOrders.length} active payment orders are linked to this invoice; verify provider state before retrying.`, 'high');
    score = Math.min(100, score);
    const level = score >= 60 ? 'critical' : score >= 35 ? 'high' : score >= 15 ? 'medium' : 'low';
    return {
      invoiceId: inv.id, invoiceNumber: inv.number, client: inv.client,
      amount: inv.amount, currency: inv.currency, overdueDays: overdue,
      score, level, signals,
      disposition: inv.disputed ? 'HOLD — dispute review required' : level === 'critical' || level === 'high' ? 'HUMAN REVIEW — verify evidence before action' : level === 'medium' ? 'REVIEW — confirm context' : 'NORMAL — follow recovery policy',
    };
  }).sort((a, b) => b.score - a.score || b.overdueDays - a.overdueDays || String(a.invoiceId).localeCompare(String(b.invoiceId)));
  const counts = rows.reduce((out, row) => { out[row.level]++; return out; }, { critical: 0, high: 0, medium: 0, low: 0 });
  return {
    generatedFor: today,
    mode: 'deterministic_review_signals',
    disclaimer: 'Risk scores prioritize human review; they are not fraud probabilities, credit scores or payment predictions.',
    totalOpen: open.length,
    flagged: rows.filter((r) => r.signals.length).length,
    counts,
    items: rows,
  };
}

module.exports = { assessPortfolioRisk, median, daysBetween };
