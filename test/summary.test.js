'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize } = require('../lib/summary');

const invoice = (overrides = {}) => ({
  id: 'inv-1',
  client: 'Acme',
  number: 'A-100',
  amount: 100,
  currency: 'USD',
  issueDate: '2026-01-01',
  dueDate: '2026-01-15',
  status: 'open',
  disputed: false,
  reminderCount: 0,
  ...overrides,
});

test('summary keeps balances and verified recovery totals separated by currency', () => {
  const result = summarize([
    invoice({ id: 'usd-open', amount: 125.50, currency: 'USD' }),
    invoice({ id: 'inr-open', amount: 9000, currency: 'INR' }),
    invoice({ id: 'usd-paid', amount: 80, currency: 'USD', status: 'paid', paymentMethod: 'paypal_sandbox' }),
  ], '2026-02-01');

  const usd = result.find((x) => x.currency === 'USD');
  const inr = result.find((x) => x.currency === 'INR');
  assert.equal(usd.outstanding, 125.5);
  assert.equal(usd.paidViaPayPal, 80);
  assert.equal(usd.paidViaPayPalCount, 1);
  assert.equal(inr.outstanding, 9000);
  assert.equal(inr.paidViaPayPal, 0);
  assert.equal(inr.paidViaPayPalCount, 0);
});

test('summary distinguishes provider-verified captures from manual/demo paid records', () => {
  const result = summarize([
    invoice({ id: 'paypal', status: 'paid', paymentMethod: 'paypal_sandbox', amount: 50 }),
    invoice({ id: 'manual', status: 'paid', paymentMethod: 'manual', amount: 70 }),
    invoice({ id: 'demo', status: 'paid', paymentMethod: 'demo', amount: 30 }),
  ], '2026-02-01')[0];

  assert.equal(result.paidViaPayPal, 50);
  assert.equal(result.paidViaPayPalCount, 1);
  assert.equal(result.paidOther, 100);
  assert.equal(result.paidOtherCount, 2);
});

test('summary counts only recorded operator confirmations as reminders and labels remain explicit', () => {
  const result = summarize([
    invoice({ id: 'open', reminderCount: 2 }),
    invoice({ id: 'paid', status: 'paid', paymentMethod: 'paypal_sandbox', reminderCount: 1 }),
    invoice({ id: 'invalid', reminderCount: -4 }),
    invoice({ id: 'fraction', reminderCount: 1.5 }),
  ], '2026-02-01')[0];

  assert.equal(result.remindersConfirmed, 3);
});

test('summary reports overdue and disputed exposure without hiding disputed invoices', () => {
  const result = summarize([
    invoice({ id: 'disputed', amount: 200, disputed: true }),
    invoice({ id: 'ordinary', amount: 300 }),
  ], '2026-02-01')[0];

  assert.equal(result.outstanding, 500);
  assert.equal(result.overdue, 500);
  assert.equal(result.disputed, 200);
  assert.equal(result.disputedCount, 1);
  assert.equal(result.overdueCount, 2);
});
