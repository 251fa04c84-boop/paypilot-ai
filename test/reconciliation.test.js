'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, reconcile } = require('../lib/reconciliation');

const invoices = [
  { id: 'a', number: 'INV-001', client: 'Acme', amount: 120, currency: 'USD', status: 'open', disputed: false },
  { id: 'b', number: 'INV-002', client: 'Beta', amount: 80, currency: 'USD', status: 'open', disputed: true },
  { id: 'c', number: 'INV-003', client: 'Gamma', amount: 50, currency: 'EUR', status: 'paid', disputed: false },
];

test('CSV parser supports quoted cells, escaped quotes and CRLF', () => {
  const rows = parseCsv('Invoice Number,Amount,Currency,Transaction ID,Status\r\n"INV-001",120,USD,"CAP-1",COMPLETED\r\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].transactionId, 'CAP-1');
  assert.equal(rows[0].status, 'COMPLETED');
});

test('exact completed payment becomes a review candidate only', () => {
  const [r] = reconcile('invoice_number,amount,currency,transaction_id,status\nINV-001,120,USD,CAP-1,COMPLETED', invoices);
  assert.equal(r.result, 'candidate');
  assert.match(r.reason, /review candidate only/);
  assert.equal(r.invoiceId, 'a');
});

test('amount or currency mismatch never auto-adjusts invoice', () => {
  const [r] = reconcile('invoice,amount,currency\nINV-001,121,USD', invoices);
  assert.equal(r.result, 'mismatch');
});

test('disputed and already-paid invoices are not treated as candidates', () => {
  const disputed = reconcile('invoice,amount,currency\nINV-002,80,USD', invoices)[0];
  const paid = reconcile('invoice,amount,currency\nINV-003,50,EUR', invoices)[0];
  assert.equal(disputed.result, 'disputed');
  assert.equal(paid.result, 'already_paid');
});

test('duplicate transaction IDs are flagged and non-completed statuses are excluded', () => {
  const duplicate = reconcile('invoice,amount,currency,transaction_id\nINV-001,120,USD,CAP-X\nINV-001,120,USD,CAP-X', invoices);
  assert.equal(duplicate[0].result, 'candidate');
  assert.equal(duplicate[1].result, 'duplicate');
  const pending = reconcile('invoice,amount,currency,status\nINV-001,120,USD,PENDING', invoices)[0];
  assert.equal(pending.result, 'not_completed');
});

test('missing invoice, malformed amount, and duplicate invoice numbers are safely classified', () => {
  const notFound = reconcile('invoice,amount,currency\nINV-X,1,USD', invoices)[0];
  const invalid = reconcile('invoice,amount,currency\nINV-001,nope,USD', invoices)[0];
  const ambiguous = reconcile('invoice,amount,currency\nINV-001,120,USD', [...invoices, { ...invoices[0], id: 'd' }])[0];
  assert.equal(notFound.result, 'unmatched');
  assert.equal(invalid.result, 'invalid');
  assert.equal(ambiguous.result, 'ambiguous');
});

test('parser rejects missing columns, unclosed quotes and excessive size', () => {
  assert.throws(() => parseCsv('invoice,amount\nINV-001,120'), /must include/);
  assert.throws(() => parseCsv('invoice,amount,currency\n"INV-001,120,USD'), /unclosed/);
  assert.throws(() => parseCsv('x'.repeat(81000)), /80 KB/);
});
