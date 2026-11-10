'use strict';

const DEFAULT_TIMEOUT_MS = 8000;

function createResendEmailProvider({ apiKey, from, appBaseUrl, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const fromAddress = typeof from === 'string' ? ((from.match(/<([^<>]+)>/) || [])[1] || from).trim() : '';
  const at = fromAddress.lastIndexOf('@');
  const configured = Boolean(
    typeof apiKey === 'string' && apiKey.trim() &&
    at > 0 && at === fromAddress.indexOf('@') && fromAddress.slice(at + 1).includes('.') &&
    typeof appBaseUrl === 'string' && /^https:\/\//i.test(appBaseUrl)
    typeof apiKey === 'string' && apiKey.trim() &&
    typeof from === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from) &&
    typeof appBaseUrl === 'string' && /^https:\/\//i.test(appBaseUrl)
  );

  return Object.freeze({
    configured,
    async sendPasswordReset({ to, token }) {
      if (!configured) throw new Error('Transactional email is not configured.');
      if (typeof to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new TypeError('Invalid recipient.');
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw new TypeError('Invalid reset token.');
      const resetUrl = new URL('/?reset_token=' + encodeURIComponent(token), appBaseUrl).toString();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            from,
            to: [to],
            subject: 'Reset your PayPilot password',
            text: 'We received a request to reset your PayPilot password. Use this one-time link within 30 minutes:\n\n' + resetUrl + '\n\nIf you did not request this, you can ignore this email.',
            html: '<p>We received a request to reset your PayPilot password.</p><p><a href="' + resetUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '">Reset your password</a></p><p>This one-time link expires in 30 minutes. If you did not request this, ignore this email.</p>'
          })
        });
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

module.exports = { createResendEmailProvider };
