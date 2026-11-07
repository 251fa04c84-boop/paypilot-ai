'use strict';

const crypto = require('node:crypto');

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const COOKIE_NAME = 'pp_session';
const TOKEN_RE = /^v1\.([a-f0-9]{64})\.([0-9]{10})\.([a-f0-9]{64})$/;

function secretBuffer(secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new TypeError('SESSION_SECRET must contain at least 32 bytes.');
  }
  return Buffer.from(secret, 'utf8');
}

function signatureFor(id, expiresAt, secret) {
  return crypto.createHmac('sha256', secretBuffer(secret))
    .update('v1.' + id + '.' + expiresAt, 'utf8')
    .digest('hex');
}

function createSessionToken({ secret, now = Date.now(), ttlSeconds = DEFAULT_TTL_SECONDS, id } = {}) {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > DEFAULT_TTL_SECONDS) {
    throw new RangeError('Session TTL must be between 60 seconds and 7 days.');
  }
  const sessionId = id || crypto.randomBytes(32).toString('hex');
  if (!/^[a-f0-9]{64}$/.test(sessionId)) throw new TypeError('Invalid session identifier.');
  const expiresAt = Math.floor(now / 1000) + ttlSeconds;
  const signature = signatureFor(sessionId, expiresAt, secret);
  return { sessionId, sessionHash: crypto.createHash('sha256').update(sessionId).digest('hex'), expiresAt, token: 'v1.' + sessionId + '.' + expiresAt + '.' + signature };
}

function verifySessionToken(token, { secret, now = Date.now(), maxTtlSeconds = DEFAULT_TTL_SECONDS } = {}) {
  if (typeof token !== 'string' || token.length > 180) return null;
  const match = TOKEN_RE.exec(token);
  if (!match) return null;
  const [, id, expText, supplied] = match;
  const expiresAt = Number(expText);
  const nowSeconds = Math.floor(now / 1000);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds || expiresAt > nowSeconds + maxTtlSeconds) return null;
  let expected;
  try { expected = signatureFor(id, expiresAt, secret); } catch (_) { return null; }
  const a = Buffer.from(supplied, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { sessionId: id, sessionHash: crypto.createHash('sha256').update(id).digest('hex'), expiresAt };
}

function readCookie(header, name = COOKIE_NAME) {
  if (typeof header !== 'string' || header.length > 8192) return null;
  const matches = [];
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) matches.push(part.slice(index + 1).trim());
  }
  return matches.length === 1 ? matches[0] : null;
}

function serializeSessionCookie(token, { secure = true, maxAgeSeconds = DEFAULT_TTL_SECONDS } = {}) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw new TypeError('Invalid session token.');
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 0 || maxAgeSeconds > DEFAULT_TTL_SECONDS) {
    throw new RangeError('Invalid cookie Max-Age.');
  }
  return COOKIE_NAME + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAgeSeconds + (secure ? '; Secure' : '');
}

function clearSessionCookie({ secure = true } = {}) {
  return COOKIE_NAME + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (secure ? '; Secure' : '');
}

module.exports = { COOKIE_NAME, DEFAULT_TTL_SECONDS, createSessionToken, verifySessionToken, readCookie, serializeSessionCookie, clearSessionCookie };
