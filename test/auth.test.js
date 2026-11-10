'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');

function fixture() {
  const states = new Map();
  const users = new Map();
  const sessions = new Map();
  return {
    accountsEnabled: true,
    states, users, sessions,
    async withTenant(tenantId, work) {
      const state = structuredClone(states.get(tenantId) || { invoices: [], drafts: [], orders: [], actions: [], proposals: [], settings: {}, processedWebhookEvents: [] });
      const result = await work({ state, async save(next) { states.set(tenantId, structuredClone(next)); } });
      return result;
    },
    async createAccount({ tenantId, email, normalizedEmail, passwordHash }) {
      if (users.has(normalizedEmail)) { const e = new Error('duplicate'); e.code = 'ACCOUNT_EXISTS'; throw e; }
      const user = { userId: 'user-' + (users.size + 1), tenantId, email, passwordHash };
      users.set(normalizedEmail, user);
      states.set(tenantId, { invoices: [], drafts: [], orders: [], actions: [], proposals: [], settings: {}, processedWebhookEvents: [] });
      return { userId: user.userId, tenantId, email };
    },
    async findUserByEmail(email) { const u = users.get(email); return u ? { ...u } : null; },
    async createSession({ sessionHash, tenantId, userId, expiresAt }) { sessions.set(sessionHash, { tenantId, userId, expiresAt, revoked: false }); },
    async resolveSession(hash, now = new Date()) {
      const s = sessions.get(hash);
      if (!s || s.revoked || s.expiresAt * 1000 <= now.getTime()) return null;
      return { tenantId: s.tenantId, userId: s.userId };
    },
    async revokeSession(hash, tenantId) {
      const s = sessions.get(hash);
      if (!s || s.tenantId !== tenantId || s.revoked) return false;
      s.revoked = true;
      return true;
    }
  };
}

async function withServer(app, run) {
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  try { await run('http://127.0.0.1:' + address.port); }
  finally { await new Promise((resolve, reject) => app.server.close((e) => e ? reject(e) : resolve())); }
}

test('registration, login, logout and private tenant routing work without trusting client tenant IDs', async () => {
  const repository = fixture();
  const app = createApp({ repository, tenantId: 'judge-demo', env: { NODE_ENV: 'test', PORT: '0', SESSION_SECRET: 'test-session-secret-which-is-longer-than-32-bytes' } });
  await withServer(app, async (base) => {
    const register = await fetch(base + '/api/auth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'Owner@Example.com', password: 'correct horse battery staple', tenantId: 'attacker-tenant' })
    });
    assert.equal(register.status, 201);
    const cookie = register.headers.get('set-cookie').split(';')[0];
    const me = await fetch(base + '/api/auth/me', { headers: { cookie } });
    assert.equal(me.status, 200);
    const identity = await me.json();
    assert.equal(identity.user.id, 'user-1');
    assert.notEqual(identity.tenantId, 'attacker-tenant');

    const create = await fetch(base + '/api/invoices', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ client: 'Private client', number: 'P-1', amount: 100, currency: 'USD', issueDate: '2026-11-01', dueDate: '2026-11-15' })
    });
    assert.equal(create.status, 201);
    const privateTenant = identity.tenantId;
    assert.equal(repository.states.get(privateTenant).invoices.length, 1);

    const secondRegister = await fetch(base + '/api/auth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'second@example.com', password: 'another secure passphrase' })
    });
    assert.equal(secondRegister.status, 201);
    const secondCookie = secondRegister.headers.get('set-cookie').split(';')[0];
    const secondInvoices = await fetch(base + '/api/invoices', { headers: { cookie: secondCookie } });
    assert.equal(secondInvoices.status, 200);
    assert.deepEqual(await secondInvoices.json(), []);

    const invalidSession = await fetch(base + '/api/invoices', { headers: { cookie: 'pp_session=not-a-valid-session' } });
    assert.equal(invalidSession.status, 401);

    const publicDemo = await fetch(base + '/api/invoices');
    assert.equal(publicDemo.status, 200);
    assert.deepEqual(await publicDemo.json(), []);
    assert.equal(repository.states.get('judge-demo'), undefined);

    const badLogin = await fetch(base + '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com', password: 'incorrect password' })
    });
    assert.equal(badLogin.status, 401);

    const login = await fetch(base + '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com', password: 'correct horse battery staple' })
    });
    assert.equal(login.status, 200);
    const loginCookie = login.headers.get('set-cookie').split(';')[0];
    const logout = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { cookie: loginCookie } });
    assert.equal(logout.status, 200);
    const afterLogout = await fetch(base + '/api/auth/me', { headers: { cookie: loginCookie } });
    assert.equal(afterLogout.status, 401);
  });
});

test('registration throttles repeated attempts for the same identity', async () => {
  const repository = fixture();
  const app = createApp({ repository, tenantId: 'judge-demo', limits: { authIdentity: 1 }, env: { NODE_ENV: 'test', PORT: '0', SESSION_SECRET: 'test-session-secret-which-is-longer-than-32-bytes' } });
  await withServer(app, async (base) => {
    const submit = () => fetch(base + '/api/auth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'limited@example.com', password: 'correct horse battery staple' })
    });
    assert.equal((await submit()).status, 201);
    const limited = await submit();
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
  });
});

test('production keeps shared demo read-only while allowing authenticated private writes', async () => {
  const repository = fixture();
  const app = createApp({ repository, tenantId: 'judge-demo', env: { NODE_ENV: 'production', PORT: '0', SESSION_SECRET: 'test-session-secret-which-is-longer-than-32-bytes' } });
  await withServer(app, async (base) => {
    const register = await fetch(base + '/api/auth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'private@example.com', password: 'correct horse battery staple' })
    });
    assert.equal(register.status, 201);
    const cookie = register.headers.get('set-cookie').split(';')[0];
    const privateWrite = await fetch(base + '/api/invoices', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ client: 'Private customer', number: 'PR-1', amount: 25, currency: 'USD', issueDate: '2026-11-01', dueDate: '2026-11-20' })
    });
    assert.equal(privateWrite.status, 201);
    const publicWrite = await fetch(base + '/api/invoices', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client: 'Shared demo customer', number: 'D-1', amount: 25, currency: 'USD', issueDate: '2026-11-01', dueDate: '2026-11-20' })
    });
    assert.equal(publicWrite.status, 403);
  });
});

test('account routes fail closed when session signing is not configured', async () => {
  const repository = fixture();
  const app = createApp({ repository, tenantId: 'judge-demo', env: { NODE_ENV: 'test', PORT: '0' } });
  await withServer(app, async (base) => {
    const response = await fetch(base + '/api/auth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com', password: 'correct horse battery staple' })
    });
    assert.equal(response.status, 503);
  });
});
