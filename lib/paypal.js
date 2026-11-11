'use strict';
// Minimal PayPal Orders v2 client. SANDBOX ONLY: the base URL is fixed, so real money cannot move.
const BASE = 'https://api-m.sandbox.paypal.com';
const { money } = require('./payments');

const DEFAULT_TIMEOUT_MS = 12000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

function createPayPal({ clientId, secret, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, maxResponseBytes = MAX_RESPONSE_BYTES } = {}) {
  let token = null, expiresAt = 0;
  const configured = () => Boolean(clientId && secret);
  const timeout = Number.isFinite(timeoutMs) ? Math.max(1000, Math.min(timeoutMs, 30000)) : DEFAULT_TIMEOUT_MS;
  const responseLimit = Number.isFinite(maxResponseBytes) ? Math.max(1024, Math.min(maxResponseBytes, 2 * 1024 * 1024)) : MAX_RESPONSE_BYTES;

  async function call(method, path, { body, headers = {} } = {}) {
    let res;
    try {
      res = await fetchImpl(BASE + path, {
        method,
        headers: Object.assign({ Accept: 'application/json' }, headers),
        body,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        const e = new Error('PayPal Sandbox request timed out. Please retry safely.');
        e.code = 'PAYPAL_TIMEOUT';
        throw e;
      }
      const e = new Error('PayPal Sandbox could not be reached. Please retry safely.');
      e.code = 'PAYPAL_NETWORK';
      throw e;
    }

    const declaredLength = Number(res.headers && res.headers.get && res.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > responseLimit) {
      const e = new Error('PayPal returned an unexpectedly large response.');
      e.code = 'PAYPAL_RESPONSE_TOO_LARGE';
      throw e;
    }

    let raw = '';
    try {
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const chunks = [];
        let total = 0;
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          total += part.value.byteLength;
          if (total > responseLimit) {
            try { await reader.cancel(); } catch (_) { /* best effort */ }
            const e = new Error('PayPal returned an unexpectedly large response.');
            e.code = 'PAYPAL_RESPONSE_TOO_LARGE';
            throw e;
          }
          chunks.push(Buffer.from(part.value));
        }
        raw = Buffer.concat(chunks, total).toString('utf8');
      } else {
        // Test doubles may expose text() without a streaming body; production fetch uses the bounded stream above.
        raw = await res.text();
        if (Buffer.byteLength(raw, 'utf8') > responseLimit) {
          const e = new Error('PayPal returned an unexpectedly large response.');
          e.code = 'PAYPAL_RESPONSE_TOO_LARGE';
          throw e;
        }
      }
    } catch (error) {
      if (error && error.code === 'PAYPAL_RESPONSE_TOO_LARGE') throw error;
      throw new Error('PayPal returned an unreadable response.');
    }
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); }
      catch (_) { throw new Error('PayPal returned an invalid response.'); }
    }
    return { status: res.status, data };
  }

  async function getToken() {
    if (!configured()) throw new Error('PayPal Sandbox is not configured.');
    if (token && Date.now() < expiresAt - 60000) return token;
    const basic = Buffer.from(`${clientId}:${secret}`).toString('base64');
    const r = await call('POST', '/v1/oauth2/token', { body: 'grant_type=client_credentials', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' } });
    if (r.status !== 200 || !r.data || typeof r.data.access_token !== 'string' || !r.data.access_token) throw new Error('PayPal rejected the Sandbox credentials.');
    token = r.data.access_token; expiresAt = Date.now() + (Number(r.data.expires_in) || 300) * 1000;
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
    let approvalUrl;
    try { approvalUrl = new URL(link && link.href); } catch (_) { /* rejected below */ }
    const trustedApprovalHosts = new Set(['www.sandbox.paypal.com', 'sandbox.paypal.com']);
    if (!approvalUrl || approvalUrl.protocol !== 'https:' || !trustedApprovalHosts.has(approvalUrl.hostname.toLowerCase()) || approvalUrl.username || approvalUrl.password) {
      throw new Error('PayPal did not return a trusted Sandbox approval link.');
    }
    return { id: r.data.id, approveUrl: link.href };
  }

  async function getOrder(id) {
    const r = await call('GET', `/v2/checkout/orders/${encodeURIComponent(id)}`, { headers: await authHeaders() });
    if (r.status !== 200 || !r.data) throw new Error(`PayPal could not return the order (HTTP ${r.status}).`);
    return r.data;
  }

  async function captureOrder(id) {
    const r = await call('POST', `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, { body: '{}', headers: await authHeaders({ 'PayPal-Request-Id': `capture-${id}` }) });
    if ((r.status === 201 || r.status === 200) && r.data) return r.data;
    const issue = r.data && r.data.details && r.data.details[0] && r.data.details[0].issue;
    if (r.status === 422 && issue === 'ORDER_ALREADY_CAPTURED') return getOrder(id);
    if (r.status === 422 && issue === 'ORDER_NOT_APPROVED') { const e = new Error('The buyer has not approved this order in PayPal yet.'); e.code = 'NOT_APPROVED'; throw e; }
    throw new Error(`PayPal could not capture the order (HTTP ${r.status}).`);
  }
  async function getWebhookEvent(eventId) {
    if (typeof eventId !== 'string' || !/^WH-[A-Za-z0-9-]{10,80}$/.test(eventId)) {
      throw new TypeError('Invalid PayPal webhook event ID.');
    }
    const r = await call('GET', '/v1/notifications/webhooks-events/' + encodeURIComponent(eventId), { headers: await authHeaders() });
    if (r.status !== 200 || !r.data) {
      const e = new Error('PayPal could not return the webhook event (HTTP ' + r.status + ').');
      e.status = r.status;
      throw e;
    }
    return r.data;
  }

  async function verifyWebhookSignature({ authAlgo, certUrl, transmissionId, transmissionSig, transmissionTime, webhookId, webhookEvent }) {
    if (!configured() || !webhookId || !authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime || !webhookEvent) return false;
    const body = JSON.stringify({
      auth_algo: authAlgo,
      cert_url: certUrl,
      transmission_id: transmissionId,
      transmission_sig: transmissionSig,
      transmission_time: transmissionTime,
      webhook_id: webhookId,
      webhook_event: webhookEvent,
    });
    const r = await call('POST', '/v1/notifications/verify-webhook-signature', { body, headers: await authHeaders() });
    return r.status === 200 && r.data && r.data.verification_status === 'SUCCESS';
  }

  return { configured, createOrder, getOrder, captureOrder, getWebhookEvent, verifyWebhookSignature };
}
module.exports = { createPayPal, DEFAULT_TIMEOUT_MS, MAX_RESPONSE_BYTES };
