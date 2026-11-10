'use strict';

const crypto = require('node:crypto');

const EMPTY_STATE = Object.freeze({ invoices: [], drafts: [], orders: [], actions: [], proposals: [], settings: {} });

class TenantNotFoundError extends Error { constructor() { super('Tenant context is unavailable.'); this.code = 'TENANT_NOT_FOUND'; } }
class ConcurrentWriteError extends Error { constructor() { super('Tenant state changed during this request. Reload and retry.'); this.code = 'CONCURRENT_WRITE'; } }

function normalizeState(value) {
  const state = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    invoices: Array.isArray(state.invoices) ? state.invoices : [],
    drafts: Array.isArray(state.drafts) ? state.drafts : [],
    orders: Array.isArray(state.orders) ? state.orders : [],
    actions: Array.isArray(state.actions) ? state.actions : [],
    proposals: Array.isArray(state.proposals) ? state.proposals : [],
    settings: state.settings && typeof state.settings === 'object' && !Array.isArray(state.settings) ? state.settings : {},
    processedWebhookEvents: Array.isArray(state.processedWebhookEvents) ? state.processedWebhookEvents : []
  };
}

function createPostgresRepository({ pool, adminPool = null, clock = () => new Date() } = {}) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('A PostgreSQL pool is required.');

  async function transaction(tenantId, work) {
    if (typeof tenantId !== 'string' || !tenantId.trim()) throw new TenantNotFoundError();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // The transaction-local value is also consumed by optional RLS policies.
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const tenant = await client.query(
        "SELECT tenant_id FROM paypilot_tenants WHERE tenant_id = $1 AND status = 'active' FOR SHARE",
        [tenantId]
      );
      if (!tenant.rows.length) throw new TenantNotFoundError();
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      client.release();
    }
  }

  return Object.freeze({
    async close() { if (typeof pool.end === 'function') await pool.end(); },

    async createTenant({ tenantId, kind = 'private' }) {
      if (!['private', 'judge_demo'].includes(kind)) throw new TypeError('Invalid tenant kind.');
      if (typeof tenantId !== 'string' || !tenantId.trim()) throw new TypeError('Invalid tenant ID.');
      if (!adminPool || typeof adminPool.connect !== 'function') {
        throw new Error('Tenant provisioning requires a separate administrator pool; runtime credentials cannot create tenants.');
      }
      const client = await adminPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          "INSERT INTO paypilot_tenants (tenant_id, tenant_kind) VALUES ($1, $2) ON CONFLICT (tenant_id) DO NOTHING",
          [tenantId, kind]
        );
        await client.query(
          "INSERT INTO paypilot_tenant_state (tenant_id, state, version) VALUES ($1, $2::jsonb, 0) ON CONFLICT (tenant_id) DO NOTHING",
          [tenantId, JSON.stringify(EMPTY_STATE)]
        );
        await client.query('COMMIT');
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        throw error;
      } finally {
        client.release();
      }
    },

    async withTenant(tenantId, work) {
      return transaction(tenantId, async (client) => {
        const row = await client.query(
          'SELECT state, version FROM paypilot_tenant_state WHERE tenant_id = $1 FOR UPDATE',
          [tenantId]
        );
        if (!row.rows.length) throw new TenantNotFoundError();
        const current = normalizeState(row.rows[0].state);
        let currentVersion = Number(row.rows[0].version);
        const tx = Object.freeze({
          state: current,
          get version() { return currentVersion; },
          save: async (nextState = current) => {
            const next = normalizeState(nextState);
            // Keep PayPal order routing and webhook replay records in the same
            // transaction as the tenant's business state. RLS scopes both tables.
            for (const order of next.orders) {
              if (!order || typeof order.orderId !== 'string' || typeof order.invoiceId !== 'string') continue;
              const routed = await client.query(
                'INSERT INTO paypilot_paypal_order_routes (order_id, tenant_id, invoice_id, proposal_id, status) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (order_id) DO UPDATE SET status = EXCLUDED.status, proposal_id = EXCLUDED.proposal_id, updated_at = now() WHERE paypilot_paypal_order_routes.tenant_id = EXCLUDED.tenant_id AND paypilot_paypal_order_routes.invoice_id = EXCLUDED.invoice_id RETURNING order_id',
                [order.orderId, tenantId, order.invoiceId, order.proposalId || null, order.status || 'created']
              );
              if (!routed.rows.length) throw new Error('PayPal order ID is already assigned to another tenant or invoice.');
            }
            for (const event of next.processedWebhookEvents) {
              if (!event || typeof event.id !== 'string') continue;
              await client.query(
                "INSERT INTO paypilot_webhook_events (event_id, tenant_id, event_type, status, received_at, processed_at) VALUES ($1, $2, 'PAYPAL_WEBHOOK', 'processed', $3, $3) ON CONFLICT (event_id) DO NOTHING",
                [event.id, tenantId, event.at ? new Date(event.at) : clock()]
              );
            }
            const updated = await client.query(
              'UPDATE paypilot_tenant_state SET state = $1::jsonb, version = version + 1, updated_at = $2 WHERE tenant_id = $3 AND version = $4 RETURNING version',
              [JSON.stringify(next), clock(), tenantId, currentVersion]
            );
            if (!updated.rows.length) throw new ConcurrentWriteError();
            currentVersion = Number(updated.rows[0].version);
            return currentVersion;
          }
        });
        return work(tx);
      });
    },

    async createAccount({ tenantId, email, normalizedEmail, passwordHash }) {
      if (!adminPool || typeof adminPool.connect !== 'function') {
        throw new Error('Account provisioning is unavailable; configure a restricted provisioning database connection.');
      }
      const client = await adminPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          "INSERT INTO paypilot_tenants (tenant_id, tenant_kind) VALUES ($1, 'private')",
          [tenantId]
        );
        await client.query(
          "INSERT INTO paypilot_tenant_state (tenant_id, state, version) VALUES ($1, $2::jsonb, 0)",
          [tenantId, JSON.stringify(EMPTY_STATE)]
        );
        const result = await client.query(
          'INSERT INTO paypilot_users (tenant_id, email, normalized_email, password_hash) VALUES ($1, $2, $3, $4) RETURNING user_id, tenant_id, email',
          [tenantId, email, normalizedEmail, passwordHash]
        );
        await client.query('COMMIT');
        return { userId: result.rows[0].user_id, tenantId: result.rows[0].tenant_id, email: result.rows[0].email };
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        if (error && error.code === '23505') {
          const duplicate = new Error('An account with that email already exists.');
          duplicate.code = 'ACCOUNT_EXISTS';
          throw duplicate;
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async findUserByEmail(normalizedEmail) {
      if (!adminPool || typeof adminPool.query !== 'function') {
        throw new Error('Account authentication is unavailable; configure the account database connection.');
      }
      const result = await adminPool.query(
        "SELECT u.user_id, u.tenant_id, u.email, u.password_hash FROM paypilot_users u JOIN paypilot_tenants t ON t.tenant_id = u.tenant_id WHERE u.normalized_email = $1 AND t.status = 'active' AND t.tenant_kind = 'private' LIMIT 1",
        [normalizedEmail]
      );
      return result.rows[0] ? {
        userId: result.rows[0].user_id,
        tenantId: result.rows[0].tenant_id,
        email: result.rows[0].email,
        passwordHash: result.rows[0].password_hash
      } : null;
    },

    async createSession({ sessionHash, tenantId, userId, expiresAt }) {
      if (!/^[a-f0-9]{64}$/.test(sessionHash)) throw new TypeError('Invalid session hash.');
      return transaction(tenantId, async (client) => {
        const result = await client.query(
          "INSERT INTO paypilot_sessions (session_hash, tenant_id, user_id, expires_at) VALUES ($1, $2, $4, $3) ON CONFLICT (session_hash) DO NOTHING RETURNING session_hash",
          [sessionHash, tenantId, new Date(expiresAt * 1000), userId]
        );
        if (!result.rows.length) throw new Error('Session hash is already registered.');
        return true;
      });
    },

    async resolveSession(sessionHash, now = clock()) {
      if (!/^[a-f0-9]{64}$/.test(sessionHash)) return null;
      // This narrowly scoped SECURITY DEFINER function resolves a random session
      // hash before the app knows its tenant; direct table access remains RLS-scoped.
      const result = await pool.query(
        'SELECT tenant_id, user_id FROM paypilot_resolve_session($1, $2)',
        [sessionHash, now]
      );
      return result.rows[0] ? { tenantId: result.rows[0].tenant_id, userId: result.rows[0].user_id || null } : null;
    },

    async revokeSession(sessionHash, tenantId) {
      return transaction(tenantId, async (client) => {
        const result = await client.query(
          'UPDATE paypilot_sessions SET revoked_at = $2 WHERE session_hash = $1 AND revoked_at IS NULL RETURNING session_hash',
          [sessionHash, clock()]
        );
        return result.rows.length === 1;
      });
    },

    async recordOrderRoute({ orderId, tenantId, invoiceId, proposalId = null }) {
      return transaction(tenantId, async (client) => {
        const result = await client.query(
          "INSERT INTO paypilot_paypal_order_routes (order_id, tenant_id, invoice_id, proposal_id) VALUES ($1, $2, $3, $4) ON CONFLICT (order_id) DO NOTHING RETURNING order_id",
          [orderId, tenantId, invoiceId, proposalId]
        );
        if (!result.rows.length) throw new Error('PayPal order ID is already registered.');
        return true;
      });
    },

    async findOrderRoute(orderId) {
      if (typeof orderId !== 'string' || !orderId.trim()) return null;
      // Order IDs are opaque; this function reveals only the tenant routing tuple.
      const result = await pool.query(
        'SELECT order_id, tenant_id, invoice_id, proposal_id, status FROM paypilot_resolve_order_route($1)',
        [orderId]
      );
      return result.rows[0] || null;
    },

    async recordWebhook({ eventId, tenantId, orderId = null, eventType, payload, status = 'received' }) {
      if (typeof tenantId !== 'string' || !tenantId.trim()) throw new TenantNotFoundError();
      const payloadHash = payload === undefined ? null : crypto.createHash('sha256').update(
        typeof payload === 'string' ? payload : JSON.stringify(payload)
      ).digest('hex');
      return transaction(tenantId, async (client) => {
        const result = await client.query(
          'INSERT INTO paypilot_webhook_events (event_id, tenant_id, order_id, event_type, payload_sha256, status) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (event_id) DO NOTHING RETURNING event_id',
          [eventId, tenantId, orderId, eventType, payloadHash, status]
        );
        return result.rows.length === 1;
      });
    },

    async markWebhookProcessed(eventId, tenantId, status = 'processed', errorCode = null) {
      if (!['processed', 'ignored', 'failed'].includes(status)) throw new TypeError('Invalid webhook status.');
      return transaction(tenantId, async (client) => {
        const result = await client.query(
          'UPDATE paypilot_webhook_events SET status = $2, processed_at = $3, error_code = $4 WHERE event_id = $1 AND status = \'received\' RETURNING event_id',
          [eventId, status, clock(), errorCode]
        );
        return result.rows.length === 1;
      });
    }
  });
}

function createPgPool({ connectionString, max = 5, idleTimeoutMillis = 10000, connectionTimeoutMillis = 5000 } = {}) {
  if (!connectionString) throw new TypeError('DATABASE_URL is required.');
  // Lazy load keeps the legacy JSON demo independent until PostgreSQL mode is deliberately enabled.
  const { Pool } = require('pg');
  return new Pool({ connectionString, max, idleTimeoutMillis, connectionTimeoutMillis, ssl: { rejectUnauthorized: true } });
}

module.exports = { createPostgresRepository, createPgPool, normalizeState, TenantNotFoundError, ConcurrentWriteError };
