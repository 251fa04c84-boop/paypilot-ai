'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assessPortfolioRisk } = require('../lib/risk-intelligence');
const inv = (overrides = {}) => Object.assign({
  id: 'i1', client: 'Acme', number: 'INV-1', amount: 100, currency: 'USD',
  dueDate: '2026-11-01', status: 'open', disputed: false, reminderCount: 0,
  lastReminderAt: null,
}, overrides);

test('risk radar detects severe overdue invoices and explains the signal', () => {
  const result = assessPortfolioRisk([inv()], [], '2026-11-11');
  assert.equal(result.items[0].score, 10);
  assert.equal(result.items[0].signals[0].code, 'overdue');
  assert.match(result.items[0].signals[0].evidence, /10 days/);
});

test('risk radar holds disputes and detects duplicate invoice references', () => {
  const result = assessPortfolioRisk([inv({ id: 'a', disputed: true }), inv({ id: 'b' })], [], '2026-11-11');
  assert.ok(result.items.every((x) => x.signals.some((s) => s.code === 'duplicate_invoice_number')));
  assert.equal(result.items.find((x) => x.invoiceId === 'a').disposition, 'HOLD — dispute review required');
});

test('risk radar detects recent contact pressure, amount outliers and multiple open orders', () => {
  const invoices = [
    inv({ id: 'a', amount: 100, reminderCount: 4, lastReminderAt: '2026-11-08' }),
    inv({ id: 'b', amount: 100 }),
    inv({ id: 'c', amount: 1000 }),
  ];
  const result = assessPortfolioRisk(invoices, [
    { invoiceId: 'c', status: 'created' }, { invoiceId: 'c', status: 'created' },
  ], '2026-11-11');
  assert.ok(result.items.find((x) => x.invoiceId === 'a').signals.some((s) => s.code === 'contact_pressure'));
  const outlier = result.items.find((x) => x.invoiceId === 'c');
  assert.ok(outlier.signals.some((s) => s.code === 'amount_outlier'));
  assert.ok(outlier.signals.some((s) => s.code === 'multiple_open_orders'));
});

test('risk radar excludes paid invoices and never labels scores as fraud probability', () => {
  const result = assessPortfolioRisk([inv(), inv({ id: 'paid', status: 'paid' })], [], '2026-11-11');
  assert.equal(result.totalOpen, 1);
  assert.match(result.disclaimer, /not fraud probabilities/);
});
