'use strict';
// Tiny in-memory sliding-window limiter. Protects the free AI quota and payment routes from abuse.
function createLimiter({ windowMs, max }) {
  const hits = new Map();
  return {
    hit(key, now = Date.now()) {
      const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
      if (arr.length >= max) {
        hits.set(key, arr);
        return { ok: false, retryAfter: Math.max(1, Math.ceil((arr[0] + windowMs - now) / 1000)) };
      }
      arr.push(now);
      hits.set(key, arr);
      if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] >= windowMs) hits.delete(k);
      return { ok: true };
    },
  };
}
module.exports = { createLimiter };
