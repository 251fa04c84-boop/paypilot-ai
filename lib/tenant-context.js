'use strict';

const { COOKIE_NAME, readCookie, verifySessionToken } = require('./session');

function createTenantContextResolver({ repository, secret, now = () => Date.now(), cookieName = COOKIE_NAME } = {}) {
  if (!repository || typeof repository.resolveSession !== 'function') throw new TypeError('A session repository is required.');
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) throw new TypeError('A strong session secret is required.');

  return async function resolveTenantContext(headers = {}) {
    const token = readCookie(headers.cookie || headers.Cookie || '', cookieName);
    const verified = verifySessionToken(token, { secret, now: now() });
    if (!verified) return null;
    const session = await repository.resolveSession(verified.sessionHash, new Date(now()));
    if (!session || typeof session.tenantId !== 'string') return null;
    return Object.freeze({ tenantId: session.tenantId, sessionHash: verified.sessionHash, kind: 'private' });
  };
}

// Judge demo context is explicit server configuration, never a client-provided tenant selector.
function createJudgeDemoContext(tenantId) {
  if (typeof tenantId !== 'string' || !tenantId.trim()) throw new TypeError('A configured judge-demo tenant ID is required.');
  return Object.freeze({ tenantId, kind: 'judge_demo' });
}

module.exports = { createTenantContextResolver, createJudgeDemoContext };
