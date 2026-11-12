'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectPaymentAnomalies, simulateRecovery } = require('../lib/ops-intelligence');
const invoice = (o = {}) => ({ id: 'i1', number: 'INV-1', amount: 100, currency: 'USD', status: 'open', disputed: false, ...o });

test('detects amount and currency mismatches without mutating source records', () => {
  const inv = invoice(), order = { orderId: 'ORDER-1', invoiceId: 'i1', amount: 120, currency: 'EUR', status: 'created', createdAt: new Date().toISOString() };
  const before = JSON.stringify([inv, order]);
  const result = detectPaymentAnomalies([inv], [order]);
  assert.ok(result.anomalies.some((x) => x.code === 'order_amount_mismatch'));
  assert.ok(result.anomalies.some((x) => x.code === 'order_currency_mismatch'));
  assert.equal(JSON.stringify([inv, order]), before);
});

test('detects duplicate provider IDs, stale orders, multiple active orders and orphan orders', () => {
  const old = new Date(Date.now() - 3600000).toISOString();
  const orders = [
    { orderId: 'DUP-1', invoiceId: 'i1', amount: 100, currency: 'USD', status: 'created', createdAt: old },
    { orderId: 'DUP-1', invoiceId: 'i1', amount: 100, currency: 'USD', status: 'approved', createdAt: old },
    { orderId: 'ORPHAN', invoiceId: 'missing', status: 'created' },
  ];
  const codes = detectPaymentAnomalies([invoice()], orders).anomalies.map((x) => x.code);
  assert.ok(codes.includes('duplicate_order_id'));
  assert.ok(codes.includes('stale_open_order'));
  assert.ok(codes.includes('multiple_active_orders'));
  assert.ok(codes.includes('orphan_order'));
});

test('simulation blocks disputes and duplicate active checkout attempts and never changes records', () => {
  const inv = invoice({ disputed: true }), before = JSON.stringify(inv);
  const result = simulateRecovery({ invoice: inv, action: 'create_checkout', today: '2026-11-11', orders: [{ invoiceId: 'i1', status: 'created' }] });
  assert.equal(result.status, 'blocked');
  assert.match(result.reason, /disputed/);
  assert.equal(result.simulationOnly, true);
  assert.deepEqual(result.changes, []);
  assert.equal(JSON.stringify(inv), before);
});

test('simulation allows only policy-eligible actions for human review, not execution', () => {
  const result = simulateRecovery({ invoice: invoice(), action: 'create_checkout', today: '2026-11-11', orders: [] });
  assert.equal(result.status, 'eligible_for_human_review');
  assert.ok(result.steps.some((s) => s.includes('explicit approval')));
  assert.equal(result.simulationOnly, true);
  assert.deepEqual(result.changes, []);
});
