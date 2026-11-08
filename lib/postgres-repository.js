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

function createPostgresRepository({ pool, clock = () => new Date() } = {}) {
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
    async createTenant({ tenantId, kind = 'private' }) {
      if (!['private', 'judge_demo'].includes(kind)) throw new TypeError('Invalid tenant kind.');
      await pool.query(
        "INSERT INTO paypilot_tenants (tenant_id, tenant_kind) VALUES ($1, $2) ON CONFLICT (tenant_id) DO NOTHING",
        [tenantId, kind]
      );
      await pool.query(
        "INSERT INTO paypilot_tenant_state (tenant_id, state, version) VALUES ($1, $2::jsonb, 0) ON CONFLICT (tenant_id) DO NOTHING",
        [tenantId, JSON.stringify(EMPTY_STATE)]
      );
    },

    async withTenant(tenantId, work) {
      return transaction(tenantId, async (client) => {
        const row = await client.query(
          'SELECT state, version FROM paypilot_tenant_state WHERE tenant_id = $1 FOR UPDATE',
          [tenantId]
        );
        if (!row.rows.length) throw new TenantNotFoundError();
        const current = normalizeState(row.rows[0].state);
        const version = Number(row.rows[0].version);
        const tx = Object.freeze({
          state: current,
          version,
          save: async (nextState = current) => {
            const next = normalizeState(nextState);
            const updated = await client.query(
              'UPDATE paypilot_tenant_state SET state = $1::jsonb, version = version + 1, updated_at = $2 WHERE tenant_id = $3 AND version = $4 RETURNING version',
              [JSON.stringify(next), clock(), tenantId, version]
            );
            if (!updated.rows.length) throw new ConcurrentWriteError();
            return Number(updated.rows[0].version);
          }
        });
        return work(tx);
      });
    },

    async createSession({ sessionHash, tenantId, expiresAt }) {
      if (!/^[a-f0-9]{64}$/.test(sessionHash)) throw new TypeError('Invalid session hash.');
      await pool.query(
        "INSERT INTO paypilot_sessions (session_hash, tenant_id, expires_at) SELECT $1, t.tenant_id, $3 FROM paypilot_tenants t WHERE t.tenant_id = $2 AND t.status = 'active'",
        [sessionHash, tenantId, new Date(expiresAt * 1000)]
      );
    },

    async resolveSession(sessionHash, now = clock()) {
      if (!/^[a-f0-9]{64}$/.test(sessionHash)) return null;
      const result = await pool.query(
        "SELECT s.tenant_id FROM paypilot_sessions s JOIN paypilot_tenants t ON t.tenant_id = s.tenant_id WHERE s.session_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2 AND t.status = 'active' LIMIT 1",
        [sessionHash, now]
      );
      return result.rows[0] ? { tenantId: result.rows[0].tenant_id } : null;
    },

    async revokeSession(sessionHash) {
      const result = await pool.query(
        'UPDATE paypilot_sessions SET revoked_at = $2 WHERE session_hash = $1 AND revoked_at IS NULL RETURNING session_hash',
        [sessionHash, clock()]
      );
      return result.rows.length === 1;
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
      const result = await pool.query(
        'SELECT order_id, tenant_id, invoice_id, proposal_id, status FROM paypilot_paypal_order_routes WHERE order_id = $1',
        [orderId]
      );
      return result.rows[0] || null;
    },

    async recordWebhook({ eventId, tenantId = null, orderId = null, eventType, payload, status = 'received' }) {
      const payloadHash = payload === undefined ? null : crypto.createHash('sha256').update(
        typeof payload === 'string' ? payload : JSON.stringify(payload)
      ).digest('hex');
      const result = await pool.query(
        'INSERT INTO paypilot_webhook_events (event_id, tenant_id, order_id, event_type, payload_sha256, status) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (event_id) DO NOTHING RETURNING event_id',
        [eventId, tenantId, orderId, eventType, payloadHash, status]
      );
      return result.rows.length === 1;
    },

    async markWebhookProcessed(eventId, status = 'processed', errorCode = null) {
      if (!['processed', 'ignored', 'failed'].includes(status)) throw new TypeError('Invalid webhook status.');
      const result = await pool.query(
        'UPDATE paypilot_webhook_events SET status = $2, processed_at = $3, error_code = $4 WHERE event_id = $1 AND status = \'received\' RETURNING event_id',
        [eventId, status, clock(), errorCode]
      );
      return result.rows.length === 1;
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
