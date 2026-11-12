'use strict';
// Pure payment-state logic. An invoice becomes "paid" ONLY through applyCapture,
// and only when PayPal's own order data passes every check below.
const { addAction, closeDrafts, closeProposals } = require('./store');

const money = (n) => (Math.round(n * 100) / 100).toFixed(2);

function verifyCapture(order, invoice, expectedOrderId) {
  if (!order || typeof order !== 'object') return { ok: false, reason: 'PayPal order response is missing.' };
  if (typeof order.id !== 'string' || !order.id.trim()) return { ok: false, reason: 'PayPal order ID is missing from the provider response.' };
  if (expectedOrderId && order.id !== expectedOrderId) return { ok: false, reason: 'PayPal returned a different order than the one recorded for this invoice.' };
  const units = Array.isArray(order.purchase_units) ? order.purchase_units : [];
  if (units.length !== 1) return { ok: false, reason: 'PayPal order must contain exactly one purchase unit; manual review is required.' };
  const pu = units[0];
  if (pu.reference_id !== invoice.id) return { ok: false, reason: 'PayPal order does not belong to this invoice.' };
  const captures = pu.payments && Array.isArray(pu.payments.captures) ? pu.payments.captures : [];
  if (!captures.length) return { ok: false, reason: 'PayPal order has no capture yet.' };
  if (captures.length !== 1) return { ok: false, reason: 'PayPal order contains multiple captures; manual reconciliation is required.' };
  const cap = captures[0];
  if (typeof cap.id !== 'string' || !cap.id.trim()) return { ok: false, reason: 'PayPal capture ID is missing from the provider response.' };
  if (cap.status === 'PENDING') return { ok: false, pending: true, reason: 'PayPal capture is pending.' };
  if (cap.status !== 'COMPLETED' || order.status !== 'COMPLETED') return { ok: false, reason: `PayPal capture status is ${cap.status}.` };
  if (!cap.amount || cap.amount.currency_code !== invoice.currency || cap.amount.value !== money(invoice.amount)) {
    return { ok: false, reason: 'Captured amount or currency does not match the invoice.' };
  }
  return { ok: true, captureId: cap.id };
}

function applyCapture(db, record, order, now = new Date()) {
  const iso = now.toISOString();
  const invoice = db.invoices.find((i) => i.id === record.invoiceId);
  if (!invoice) { record.status = 'failed'; return { outcome: 'failed', message: 'Invoice no longer exists.' }; }
  const v = verifyCapture(order, invoice, record.orderId);

  if (v.pending) {
    record.status = 'pending';
    addAction(db, { invoiceId: invoice.id, type: 'payment_pending', detail: `PayPal Sandbox order ${record.orderId} is pending. Invoice stays open.` }, iso);
    return { outcome: 'pending', message: 'Payment is pending at PayPal. The invoice stays open until it completes.' };
  }
  if (!v.ok) {
    record.status = 'failed';
    addAction(db, { invoiceId: invoice.id, type: 'payment_failed', detail: `Order ${record.orderId} not accepted: ${v.reason} Invoice unchanged.` }, iso);
    return { outcome: 'failed', message: v.reason };
  }
  if (invoice.status === 'paid') {
    record.status = 'captured'; record.captureId = v.captureId;
    addAction(db, { invoiceId: invoice.id, type: 'duplicate_payment', detail: `Order ${record.orderId} also completed although the invoice was already paid. Needs a manual refund review in the PayPal Sandbox dashboard.` }, iso);
    return { outcome: 'duplicate_payment', message: 'This invoice was already paid. Review this extra payment in your PayPal Sandbox dashboard.' };
  }
  if (invoice.status === 'open' && invoice.disputed) {
    invoice.status = 'paid';
    invoice.paidAt = iso.slice(0, 10);
    invoice.paymentMethod = 'paypal_sandbox';
    invoice.paymentRef = v.captureId;
    record.status = 'captured'; record.captureId = v.captureId;
    addAction(db, { invoiceId: invoice.id, type: 'payment_captured_during_dispute', detail: 'PayPal Sandbox capture ' + v.captureId + ' was already completed while the invoice was disputed. The verified payment is recorded, but the dispute remains flagged for manual review.' }, iso);
    closeDrafts(db, invoice.id, 'the invoice was paid', iso);
    closeProposals(db, invoice.id, 'the invoice was paid', iso);
    return { outcome: 'paid_disputed', message: 'PayPal had already completed this capture while the invoice was disputed. The verified payment is recorded; manual dispute/refund review is required.' };
  }
  if (invoice.status !== 'open') {
    record.status = 'captured'; record.captureId = v.captureId;
    addAction(db, { invoiceId: invoice.id, type: 'payment_on_void', detail: `Order ${record.orderId} completed on a void invoice. Needs a manual refund review.` }, iso);
    return { outcome: 'failed', message: 'Invoice is void. Review this payment manually.' };
  }
  invoice.status = 'paid';
  invoice.paidAt = iso.slice(0, 10);
  invoice.paymentMethod = 'paypal_sandbox';
  invoice.paymentRef = v.captureId;
  record.status = 'captured'; record.captureId = v.captureId;
  addAction(db, { invoiceId: invoice.id, type: 'payment_captured', detail: `PayPal Sandbox capture ${v.captureId} verified server-side (${money(invoice.amount)} ${invoice.currency}). Invoice marked paid.` }, iso);
  closeDrafts(db, invoice.id, 'the invoice was paid', iso);
  closeProposals(db, invoice.id, 'the invoice was paid', iso);
  return { outcome: 'paid', message: 'Payment verified. Invoice marked paid.' };
}

module.exports = { verifyCapture, applyCapture, money };
