'use strict';
const crypto = require('node:crypto');
// Minimal PayPal Orders v2 client. SANDBOX ONLY: the base URL is fixed, so real money cannot move.
const BASE = 'https://api-m.sandbox.paypal.com';
const { money } = require('./payments');

const DEFAULT_TIMEOUT_MS = 12000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

function crc32(input) {
  const bytes = Buffer.from(input);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createPayPal({ clientId, secret, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, maxResponseBytes = MAX_RESPONSE_BYTES } = {}) {
  let token = null, expiresAt = 0;
  const certificateCache = new Map();
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
  async function listWebhookEvents({ startTime, endTime, pageSize = 100, eventType } = {}) {
    const params = new URLSearchParams();
    if (typeof startTime === 'string' && startTime) params.set('start_time', startTime);
    if (typeof endTime === 'string' && endTime) params.set('end_time', endTime);
    params.set('page_size', String(Math.max(1, Math.min(100, Number(pageSize) || 100))));
    if (typeof eventType === 'string' && eventType) params.set('event_type', eventType);
    const r = await call('GET', '/v1/notifications/webhooks-events?' + params.toString(), { headers: await authHeaders() });
    if (r.status !== 200 || !r.data) {
      const e = new Error('PayPal could not list webhook events (HTTP ' + r.status + ').');
      e.status = r.status;
      throw e;
    }
    return r.data;
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

  async function getSimulatorCertificate(certUrl) {
    let parsed;
    try { parsed = new URL(certUrl); } catch (_) { return null; }
    const allowedHosts = new Set(['api-m.sandbox.paypal.com', 'api.sandbox.paypal.com']);
    if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname.toLowerCase()) ||
        (parsed.port && parsed.port !== '443') || parsed.username || parsed.password ||
        parsed.search || parsed.hash || !/^\/v1\/notifications\/certs\/[A-Za-z0-9_-]+$/.test(parsed.pathname)) return null;
    const cached = certificateCache.get(parsed.href);
    if (cached && cached.expiresAt > Date.now()) return cached.pem;
    const response = await fetchImpl(parsed.href, {
      method: 'GET',
      headers: { Accept: 'application/x-pem-file' },
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) return null;
    const length = Number(response.headers && response.headers.get && response.headers.get('content-length'));
    if (Number.isFinite(length) && length > 256 * 1024) return null;
    const pem = await response.text();
    if (typeof pem !== 'string' || (!pem.includes('-----BEGIN CERTIFICATE-----') && !pem.includes('-----BEGIN PUBLIC KEY-----')) || Buffer.byteLength(pem, 'utf8') > 256 * 1024) return null;
    if (certificateCache.size >= 20) certificateCache.delete(certificateCache.keys().next().value);
    certificateCache.set(parsed.href, { pem, expiresAt: Date.now() + 60 * 60 * 1000 });
    return pem;
  }

  async function verifySimulatorWebhookSignature({ authAlgo, certUrl, transmissionId, transmissionSig, transmissionTime, rawBody }) {
    if (authAlgo !== 'SHA256withRSA' || typeof rawBody !== 'string' || !rawBody ||
        typeof transmissionId !== 'string' || !transmissionId || transmissionId.includes('|') ||
        typeof transmissionTime !== 'string' || !transmissionTime || transmissionTime.includes('|') ||
        typeof transmissionSig !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(transmissionSig)) return false;
    try {
      const certificate = await getSimulatorCertificate(certUrl);
      if (!certificate) return false;
      const checksum = crc32(Buffer.from(rawBody, 'utf8'));
      const message = transmissionId + '|' + transmissionTime + '|WEBHOOK_ID|' + checksum;
      const verifier = crypto.createVerify('SHA256');
      verifier.update(message, 'utf8');
      verifier.end();
      return verifier.verify(certificate, Buffer.from(transmissionSig, 'base64'));
    } catch (_) {
      return false;
    }
  }

  async function getWebhook(webhookId) {
    if (typeof webhookId !== 'string' || !/^[A-Za-z0-9-]{10,50}$/.test(webhookId)) {
      throw new TypeError('Invalid PayPal webhook ID.');
    }
    const r = await call('GET', '/v1/notifications/webhooks/' + encodeURIComponent(webhookId), { headers: await authHeaders() });
    if (r.status !== 200 || !r.data) {
      const e = new Error('PayPal could not return the registered webhook (HTTP ' + r.status + ').');
      e.status = r.status;
      throw e;
    }
    return r.data;
  }

  async function simulateWebhookEvent({ url, eventType = 'PAYMENT.CAPTURE.COMPLETED' } = {}) {
    if (!configured()) throw new Error('PayPal Sandbox is not configured.');
    let target;
    try { target = new URL(url); } catch (_) { throw new TypeError('Invalid simulator webhook URL.'); }
    if (target.protocol !== 'https:' || target.hostname !== 'paypilot-ai-pg-staging.onrender.com' ||
        target.pathname !== '/api/paypal/webhook' || target.username || target.password ||
        eventType !== 'PAYMENT.CAPTURE.COMPLETED') {
      throw new TypeError('Only the registered staging PayPal webhook endpoint and capture-completed test event are allowed.');
    }
    const body = JSON.stringify({ url: target.href, event_type: eventType, resource_version: '2.0' });
    const response = await call('POST', '/v1/notifications/simulate-event', { body, headers: await authHeaders() });
    if (![200, 201, 202].includes(response.status)) {
      const error = new Error('PayPal could not queue the Sandbox webhook simulator event (HTTP ' + response.status + ').');
      error.status = response.status;
      throw error;
    }
    return { status: response.status, data: response.data };
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

  return { configured, createOrder, getOrder, captureOrder, listWebhookEvents, getWebhookEvent, getWebhook, verifyWebhookSignature, verifySimulatorWebhookSignature, simulateWebhookEvent };
}
module.exports = { createPayPal, DEFAULT_TIMEOUT_MS, MAX_RESPONSE_BYTES, crc32 };
