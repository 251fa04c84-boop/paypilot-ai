'use strict';
// Pure payment-state logic. An invoice becomes "paid" ONLY through applyCapture,
// and only when PayPal's own order data passes every check below.
const { addAction, closeDrafts } = require('./store');

const money = (n) => (Math.round(n * 100) / 100).toFixed(2);

function verifyCapture(order, invoice) {
  const pu = order && order.purchase_units && order.purchase_units[0];
  if (!pu) return { ok: false, reason: 'PayPal order has no purchase unit.' };
  if (pu.reference_id !== invoice.id) return { ok: false, reason: 'PayPal order does not belong to this invoice.' };
  const cap = pu.payments && pu.payments.captures && pu.payments.captures[0];
  if (!cap) return { ok: false, reason: 'PayPal order has no capture yet.' };
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
  const v = verifyCapture(order, invoice);

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
  return { outcome: 'paid', message: 'Payment verified. Invoice marked paid.' };
}

module.exports = { verifyCapture, applyCapture, money };
