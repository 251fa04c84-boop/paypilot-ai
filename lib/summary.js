'use strict';
// Deterministic portfolio totals, grouped per currency. Plain arithmetic: no AI involved.
const { assess } = require('./priority');

const cents = (n) => Math.round(n * 100);

function summarize(invoices, now) {
  const out = {};
  for (const inv of invoices) {
    const c = (out[inv.currency] = out[inv.currency] || { currency: inv.currency, outstanding: 0, overdue: 0, atRisk: 0, dueSoon: 0, paidViaPayPal: 0, paidOther: 0, openCount: 0, overdueCount: 0, atRiskCount: 0 });
    const amt = cents(inv.amount);
    if (inv.status === 'paid') {
      if (inv.paymentMethod === 'paypal_sandbox') c.paidViaPayPal += amt; else c.paidOther += amt;
    } else if (inv.status === 'open') {
      const a = assess(inv, now);
      c.outstanding += amt; c.openCount++;
      if (a.overdueDays > 0) { c.overdue += amt; c.overdueCount++; }
      if (a.overdueDays > 30) { c.atRisk += amt; c.atRiskCount++; }
      if (a.overdueDays === 0 && a.reasons[0] && /^Due (today|in [1-7] day)/.test(a.reasons[0])) c.dueSoon += amt;
    }
  }
  const fmt = (v) => v / 100;
  return Object.values(out).map((c) => Object.assign({}, c, { outstanding: fmt(c.outstanding), overdue: fmt(c.overdue), atRisk: fmt(c.atRisk), dueSoon: fmt(c.dueSoon), paidViaPayPal: fmt(c.paidViaPayPal), paidOther: fmt(c.paidOther) }));
}
module.exports = { summarize };
