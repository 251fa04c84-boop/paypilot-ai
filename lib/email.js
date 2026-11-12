'use strict';

const DEFAULT_TIMEOUT_MS = 8000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{40,60}$/;

function isConfigured({ apiKey, from, appBaseUrl }) {
  const fromAddress = typeof from === 'string' ? ((from.match(/<([^<>]+)>/) || [])[1] || from).trim() : '';
  const at = fromAddress.lastIndexOf('@');
  return Boolean(typeof apiKey === 'string' && apiKey.trim() &&
    at > 0 && at === fromAddress.indexOf('@') && fromAddress.slice(at + 1).includes('.') &&
    typeof appBaseUrl === 'string' && /^https:\/\//i.test(appBaseUrl));
}

function createProvider({ apiKey, from, appBaseUrl, endpoint, providerName, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const configured = isConfigured({ apiKey, from, appBaseUrl });
  return Object.freeze({
    configured,
    provider: providerName,
    async sendPasswordReset({ to, token }) {
      if (!configured) throw new Error('Transactional email is not configured.');
      if (typeof to !== 'string' || !EMAIL_RE.test(to)) throw new TypeError('Invalid recipient.');
      if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw new TypeError('Invalid reset token.');
      const resetUrl = new URL('/?reset_token=' + encodeURIComponent(token), appBaseUrl).toString();
      const safeUrl = resetUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      const text = 'We received a request to reset your PayPilot password. Use this one-time link within 30 minutes:\n\n' + resetUrl + '\n\nIf you did not request this, you can ignore this email.';
      const html = '<p>We received a request to reset your PayPilot password.</p><p><a href="' + safeUrl + '">Reset your password</a></p><p>This one-time link expires in 30 minutes. If you did not request this, ignore this email.</p>';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const brevoFrom = ((from.match(/<([^<>]+)>/) || [])[1] || from).trim();
        const body = providerName === 'Brevo'
          ? { sender: { email: brevoFrom, name: (from.match(/^([^<]+)</) || [])[1]?.trim() || 'PayPilot Accounts' }, to: [{ email: to }], subject: 'Reset your PayPilot password', textContent: text, htmlContent: html }
          : { from, to: [to], subject: 'Reset your PayPilot password', text, html };
        const headers = { 'Content-Type': 'application/json' };
        if (providerName === 'Brevo') headers['api-key'] = apiKey;
        else headers.Authorization = 'Bearer ' + apiKey;
        const response = await fetchImpl(endpoint, { method: 'POST', headers, signal: controller.signal, body: JSON.stringify(body) });
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new Error('Transactional email provider rejected the message (' + response.status + '). ' + detail.slice(0, 200));
        }
        return true;
      } finally {
        clearTimeout(timeout);
      }
    }
  });
}

function createResendEmailProvider(options = {}) {
  return createProvider({ ...options, endpoint: 'https://api.resend.com/emails', providerName: 'Resend' });
}

function createBrevoEmailProvider(options = {}) {
  return createProvider({ ...options, endpoint: 'https://api.brevo.com/v3/smtp/email', providerName: 'Brevo' });
}

module.exports = { createResendEmailProvider, createBrevoEmailProvider };
