'use strict';
// Minimal PayPal Orders v2 client. SANDBOX ONLY: the base URL is fixed, so real money cannot move.
const BASE = 'https://api-m.sandbox.paypal.com';
const { money } = require('./payments');

function createPayPal({ clientId, secret, fetchImpl = fetch } = {}) {
  let token = null, expiresAt = 0;
  const configured = () => Boolean(clientId && secret);

  async function call(method, path, { body, headers = {} } = {}) {
    const res = await fetchImpl(BASE + path, { method, headers: Object.assign({ Accept: 'application/json' }, headers), body });
    let data = null;
    try { data = await res.json(); } catch (_) { /* empty body */ }
    return { status: res.status, data };
  }

  async function getToken() {
    if (!configured()) throw new Error('PayPal Sandbox is not configured.');
    if (token && Date.now() < expiresAt - 60000) return token;
    const basic = Buffer.from(`${clientId}:${secret}`).toString('base64');
    const r = await call('POST', '/v1/oauth2/token', { body: 'grant_type=client_credentials', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' } });
    if (r.status !== 200 || !r.data || !r.data.access_token) throw new Error('PayPal rejected the Sandbox credentials.');
    token = r.data.access_token; expiresAt = Date.now() + (r.data.expires_in || 300) * 1000;
    return token;
  }
  const authHeaders = async (extra = {}) => Object.assign({ Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' }, extra);

  async function createOrder({ invoice, requestId, returnUrl, cancelUrl }) {
    const body = JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: invoice.id, description: `Invoice ${invoice.number}`.slice(0, 120), amount: { currency_code: invoice.currency, value: money(invoice.amount) } }],
      payment_source: { paypal: { experience_context: { return_url: returnUrl, cancel_url: cancelUrl, user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING' } } },
    });
    const r = await call('POST', '/v2/checkout/orders', { body, headers: await authHeaders({ 'PayPal-Request-Id': requestId }) });
    if (!r.data || !r.data.id || r.status >= 300) throw new Error(`PayPal could not create the order (HTTP ${r.status}).`);
    const link = (r.data.links || []).find((l) => l.rel === 'payer-action' || l.rel === 'approve');
    if (!link) throw new Error('PayPal did not return an approval link.');
    return { id: r.data.id, approveUrl: link.href };
  }

  async function getOrder(id) {
    const r = await call('GET', `/v2/checkout/orders/${encodeURIComponent(id)}`, { headers: await authHeaders() });
    if (r.status !== 200) throw new Error(`PayPal could not return the order (HTTP ${r.status}).`);
    return r.data;
  }

  async function captureOrder(id) {
    const r = await call('POST', `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, { body: '{}', headers: await authHeaders({ 'PayPal-Request-Id': `capture-${id}` }) });
    if (r.status === 201 || r.status === 200) return r.data;
    const issue = r.data && r.data.details && r.data.details[0] && r.data.details[0].issue;
    if (r.status === 422 && issue === 'ORDER_ALREADY_CAPTURED') return getOrder(id);
    if (r.status === 422 && issue === 'ORDER_NOT_APPROVED') { const e = new Error('The buyer has not approved this order in PayPal yet.'); e.code = 'NOT_APPROVED'; throw e; }
    throw new Error(`PayPal could not capture the order (HTTP ${r.status}).`);
  }
  return { configured, createOrder, getOrder, captureOrder };
}
module.exports = { createPayPal };
