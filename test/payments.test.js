'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyCapture, applyCapture } = require('../lib/payments');

const mk = () => ({ invoices: [{ id: 'inv1', number: 'N1', amount: 120.5, currency: 'USD', status: 'open' }], orders: [], actions: [], drafts: [] });
const ord = (o = {}) => ({ status: 'COMPLETED', purchase_units: [{ reference_id: 'inv1', payments: { captures: [Object.assign({ id: 'CAP1', status: 'COMPLETED', amount: { value: '120.50', currency_code: 'USD' } }, o.cap || {})] } }] });
const rec = () => ({ orderId: 'ORD1', invoiceId: 'inv1', status: 'created' });

test('completed, matching capture marks invoice paid and logs it', () => {
  const db = mk(), r = rec();
  assert.equal(applyCapture(db, r, ord()).outcome, 'paid');
  assert.equal(db.invoices[0].status, 'paid'); assert.equal(db.invoices[0].paymentRef, 'CAP1');
  assert.equal(r.status, 'captured'); assert.equal(db.actions[0].type, 'payment_captured');
});
test('paying an invoice closes its unsent drafts', () => {
  const db = mk(); db.drafts.push({ id: 'd1', invoiceId: 'inv1', status: 'draft' }, { id: 'd2', invoiceId: 'inv1', status: 'approved' }, { id: 'd3', invoiceId: 'inv1', status: 'sent' });
  applyCapture(db, rec(), ord());
  assert.deepEqual(db.drafts.map((d) => d.status), ['discarded', 'discarded', 'sent']);
  assert.ok(db.actions.some((a) => a.type === 'drafts_closed'));
});
test('amount mismatch is rejected and invoice stays open', () => {
  const db = mk(); const res = applyCapture(db, rec(), ord({ cap: { amount: { value: '1.00', currency_code: 'USD' } } }));
  assert.equal(res.outcome, 'failed'); assert.equal(db.invoices[0].status, 'open');
});
test('currency mismatch is rejected', () => {
  const db = mk(); assert.equal(applyCapture(db, rec(), ord({ cap: { amount: { value: '120.50', currency_code: 'EUR' } } })).outcome, 'failed');
  assert.equal(db.invoices[0].status, 'open');
});
test('order for a different invoice is rejected', () => {
  const db = mk(); const o = ord(); o.purchase_units[0].reference_id = 'other';
  assert.equal(applyCapture(db, rec(), o).outcome, 'failed'); assert.equal(db.invoices[0].status, 'open');
});
test('pending capture keeps invoice open', () => {
  const db = mk(), r = rec(); const res = applyCapture(db, r, ord({ cap: { status: 'PENDING' } }));
  assert.equal(res.outcome, 'pending'); assert.equal(r.status, 'pending'); assert.equal(db.invoices[0].status, 'open');
});
test('declined or unapproved order never marks paid', () => {
  const db = mk(); const o = ord(); o.status = 'APPROVED';
  assert.equal(applyCapture(db, rec(), o).outcome, 'failed'); assert.equal(db.invoices[0].status, 'open');
  assert.equal(verifyCapture({ purchase_units: [{ reference_id: 'inv1' }] }, db.invoices[0]).ok, false);
  assert.equal(verifyCapture(null, db.invoices[0]).ok, false);
});
test('a second completed payment on a paid invoice is flagged, not silently accepted', () => {
  const db = mk(); db.invoices[0].status = 'paid';
  const res = applyCapture(db, rec(), ord()); assert.equal(res.outcome, 'duplicate_payment');
  assert.equal(db.actions[0].type, 'duplicate_payment');
});
