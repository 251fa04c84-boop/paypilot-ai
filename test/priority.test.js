'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/priority');

const inv = (o = {}) => Object.assign({ id: 'a1', client: 'X', number: 'N1', amount: 500, currency: 'USD', issueDate: '2026-01-01', dueDate: '2026-02-01', status: 'open', reminderCount: 0, lastReminderAt: null }, o);

test('date maths: overdue only after the due date', () => {
  assert.equal(P.assess(inv({ dueDate: '2026-02-10' }), '2026-02-10').overdueDays, 0);
  assert.equal(P.assess(inv({ dueDate: '2026-02-10' }), '2026-02-11').overdueDays, 1);
  assert.equal(P.assess(inv({ dueDate: '2026-02-28' }), '2026-03-01').overdueDays, 1);
  assert.equal(P.assess(inv({ dueDate: '2028-02-28' }), '2028-03-01').overdueDays, 2); // leap year
});
test('parseDate rejects impossible dates', () => {
  assert.equal(P.parseDate('2026-02-30'), null);
  assert.equal(P.parseDate('2026-13-01'), null);
  assert.equal(P.parseDate('tomorrow'), null);
  assert.ok(P.parseDate('2026-02-28'));
});
test('validateInvoice catches bad input', () => {
  assert.deepEqual(P.validateInvoice(inv()), []);
  assert.ok(P.validateInvoice(inv({ dueDate: '2025-12-31' })).some((m) => /before the issue/.test(m)));
  assert.ok(P.validateInvoice(inv({ amount: -5 })).length);
  assert.ok(P.validateInvoice(inv({ amount: '5' })).length);
  assert.ok(P.validateInvoice(inv({ client: '  ' })).length);
  assert.ok(P.validateInvoice(inv({ currency: 'usd' })).length);
});
test('recommended tone follows days overdue', () => {
  const t = (days) => P.assess(inv({ dueDate: '2026-03-01' }), new Date(Date.parse('2026-03-01T00:00:00Z') + days * 86400000).toISOString().slice(0, 10)).action;
  assert.equal(t(0), 'courtesy_reminder'); // due today is not overdue
  assert.equal(t(1), 'friendly_reminder'); assert.equal(t(7), 'friendly_reminder');
  assert.equal(t(8), 'firm_follow_up'); assert.equal(t(30), 'firm_follow_up');
  assert.equal(t(31), 'final_notice');
});
test('paid and void invoices need no action', () => {
  for (const status of ['paid', 'void']) { const a = P.assess(inv({ status }), '2026-06-01'); assert.equal(a.level, 'none'); assert.equal(a.score, 0); }
});
test('recent reminder means wait', () => {
  const a = P.assess(inv({ reminderCount: 1, lastReminderAt: '2026-03-09' }), '2026-03-10');
  assert.equal(a.action, 'wait_recent_reminder'); assert.equal(a.tone, null);
});
test('scoring is deterministic (no randomness) and explained', () => {
  const a = P.assess(inv(), '2026-03-15'), b = P.assess(inv(), '2026-03-15');
  assert.deepEqual(a, b);
  assert.ok(a.reasons.length >= 2); assert.ok(a.reasons.some((r) => /past the due date/.test(r)));
});
test('higher amount and longer overdue rank higher; queue is sorted', () => {
  const list = [inv({ id: 'b', amount: 100, dueDate: '2026-03-01' }), inv({ id: 'c', amount: 9000, dueDate: '2026-01-15' }), inv({ id: 'd', status: 'paid' }), inv({ id: 'e', dueDate: '2026-12-01' })];
  const q = P.recoveryQueue(list, '2026-03-10');
  assert.deepEqual(q.map((x) => x.invoiceId), ['c', 'b']);
});
test('invoices we advise waiting on rank below actionable ones and are never high priority', () => {
  const list = [inv({ id: 'w', amount: 9000, dueDate: '2026-01-01', reminderCount: 3, lastReminderAt: '2026-03-09' }), inv({ id: 'x', amount: 50, dueDate: '2026-03-05' })];
  const q = P.recoveryQueue(list, '2026-03-10');
  assert.deepEqual(q.map((a) => a.invoiceId), ['x', 'w']); assert.equal(q[1].level, 'low');
});
test('a large invoice 12 days overdue is not rated low', () => {
  assert.notEqual(P.assess(inv({ amount: 2800, dueDate: '2026-02-26' }), '2026-03-10').level, 'low');
});
