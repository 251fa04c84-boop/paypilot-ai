'use strict';

const ACTIVE = new Set(['created', 'approved', 'PENDING']);
function detectPaymentAnomalies(invoices, orders, now = Date.now()) {
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const grouped = new Map();
  for (const order of orders) {
    const key = String(order.orderId || '');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(order);
  }
  const anomalies = [];
  const add = (code, severity, order, invoice, evidence) => anomalies.push({
    code, severity, orderId: order.orderId || null, invoiceId: invoice?.id || order.invoiceId || null,
    invoiceNumber: invoice?.number || null, evidence,
    action: 'HOLD FOR HUMAN REVIEW — do not retry or settle based on this signal alone',
  });
  for (const [orderId, matches] of grouped) {
    if (orderId && matches.length > 1) for (const order of matches) add('duplicate_order_id', 'critical', order, byId.get(order.invoiceId), `Provider order reference appears ${matches.length} times in the local order ledger.`);
  }
  const activeByInvoice = new Map();
  for (const order of orders) {
    const invoice = byId.get(order.invoiceId);
    if (!invoice) { add('orphan_order', 'high', order, null, 'Payment order references an invoice that is absent from this workspace.'); continue; }
    if (Number.isFinite(Number(order.amount)) && Math.round(Number(order.amount) * 100) !== Math.round(Number(invoice.amount) * 100)) {
      add('order_amount_mismatch', 'critical', order, invoice, 'Stored order amount differs from the current invoice amount.');
    }
    if (order.currency && invoice.currency && String(order.currency).toUpperCase() !== String(invoice.currency).toUpperCase()) {
      add('order_currency_mismatch', 'critical', order, invoice, 'Stored order currency differs from the current invoice currency.');
    }
    if (ACTIVE.has(order.status)) {
      if (!activeByInvoice.has(invoice.id)) activeByInvoice.set(invoice.id, []);
      activeByInvoice.get(invoice.id).push(order);
      const age = now - Date.parse(order.createdAt || '');
      if (Number.isFinite(age) && age > 30 * 60 * 1000) add('stale_open_order', 'medium', order, invoice, `Open payment order is approximately ${Math.floor(age / 60000)} minutes old; verify provider state before retrying.`);
    }
  }
  for (const [invoiceId, list] of activeByInvoice) if (list.length > 1) {
    const invoice = byId.get(invoiceId);
    for (const order of list) add('multiple_active_orders', 'high', order, invoice, `${list.length} active payment orders are associated with this invoice.`);
  }
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  anomalies.sort((a, b) => rank[a.severity] - rank[b.severity] || String(a.invoiceNumber || '').localeCompare(String(b.invoiceNumber || '')));
  return { mode: 'deterministic_ledger_checks', totalOrders: orders.length, anomalyCount: anomalies.length, anomalies,
    disclaimer: 'These are ledger consistency checks, not a fraud determination. Confirm provider state and source documents before action.' };
}

function simulateRecovery({ invoice, action, today, riskSignals = [], orders = [] }) {
  if (!invoice) return { status: 'blocked', action, reason: 'Invoice was not found in this workspace.', steps: [], changes: [] };
  const supported = ['draft_reminder', 'create_checkout'];
  if (!supported.includes(action)) return { status: 'blocked', action, reason: 'Unsupported simulation action.', steps: [], changes: [] };
  const active = orders.filter((o) => o.invoiceId === invoice.id && ACTIVE.has(o.status));
  const steps = ['Read invoice status, due date, dispute flag and linked payment orders.', 'Evaluate deterministic policy and risk signals.', 'Present the exact proposed next step for a human decision.'];
  const blocked = [];
  if (invoice.status !== 'open') blocked.push(`Invoice status is ${invoice.status}; only open invoices are eligible.`);
  if (invoice.disputed) blocked.push('Invoice is disputed; collection and checkout remain paused.');
  if (action === 'draft_reminder' && riskSignals.some((s) => s.code === 'contact_pressure')) blocked.push('Repeated recent reminders require a human contact-history review before another reminder.');
  if (action === 'draft_reminder' && riskSignals.some((s) => s.code === 'duplicate_invoice_number')) blocked.push('Duplicate invoice references require manual identity verification before contacting the client.');
  if (action === 'create_checkout' && active.length) blocked.push(`${active.length} active payment order(s) already exist; inspect provider state instead of creating another order.`);
  if (action === 'create_checkout' && riskSignals.some((s) => s.code === 'duplicate_invoice_number')) blocked.push('Duplicate invoice references require manual identity verification before checkout.');
  if (action === 'draft_reminder' && !blocked.length) steps.push('A reminder draft could be prepared; it would not be sent automatically.');
  if (action === 'create_checkout' && !blocked.length) steps.push('A PayPal Sandbox checkout could be created only after a separate explicit approval and server-side revalidation.');
  steps.push('No API call to PayPal or email is made by this simulation.', 'No invoice, order, approval, proposal or audit record is changed.');
  return { status: blocked.length ? 'blocked' : 'eligible_for_human_review', action, invoiceId: invoice.id,
    invoiceNumber: invoice.number, amount: invoice.amount, currency: invoice.currency,
    reason: blocked.length ? blocked.join(' ') : 'Policy checks passed for a proposal. This is not approval or execution.',
    blockers: blocked, steps, changes: [], simulationOnly: true };
}

module.exports = { detectPaymentAnomalies, simulateRecovery };
