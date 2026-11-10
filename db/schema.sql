-- PayPilot AI tenant storage foundation.
-- This schema is intentionally separate from the legacy shared JSON demo store.
-- Do not import existing shared demo records into a private tenant.
-- Application code must use a request-scoped tenant context and transactions
-- before these tables are used for customer data.

CREATE TABLE IF NOT EXISTS paypilot_tenants (
  tenant_id TEXT PRIMARY KEY,
  tenant_kind TEXT NOT NULL CHECK (tenant_kind IN ('judge_demo', 'private')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS paypilot_one_judge_demo_tenant
  ON paypilot_tenants (tenant_kind)
  WHERE tenant_kind = 'judge_demo';

CREATE TABLE IF NOT EXISTS paypilot_users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL UNIQUE REFERENCES paypilot_tenants(tenant_id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  normalized_email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL CHECK (length(password_hash) BETWEEN 40 AND 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (normalized_email = lower(trim(normalized_email)))
);

CREATE TABLE IF NOT EXISTS paypilot_tenant_state (
  tenant_id TEXT PRIMARY KEY REFERENCES paypilot_tenants(tenant_id) ON DELETE CASCADE,
  state JSONB NOT NULL DEFAULT '{"invoices":[],"drafts":[],"orders":[],"actions":[],"proposals":[],"settings":{}}'::jsonb,
  version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(state) = 'object')
);

CREATE TABLE IF NOT EXISTS paypilot_sessions (
  session_hash TEXT PRIMARY KEY CHECK (session_hash ~ '^[a-f0-9]{64}$'),
  tenant_id TEXT NOT NULL REFERENCES paypilot_tenants(tenant_id) ON DELETE CASCADE,
  user_id UUID REFERENCES paypilot_users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS paypilot_sessions_user_expiry
  ON paypilot_sessions (user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS paypilot_sessions_tenant_expiry
  ON paypilot_sessions (tenant_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS paypilot_paypal_order_routes (
  order_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES paypilot_tenants(tenant_id) ON DELETE CASCADE,
  invoice_id TEXT NOT NULL,
  proposal_id TEXT,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'captured', 'failed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paypilot_order_routes_tenant_invoice
  ON paypilot_paypal_order_routes (tenant_id, invoice_id);

CREATE TABLE IF NOT EXISTS paypilot_webhook_events (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES paypilot_tenants(tenant_id) ON DELETE SET NULL,
  order_id TEXT,
  event_type TEXT NOT NULL,
  payload_sha256 TEXT CHECK (payload_sha256 IS NULL OR payload_sha256 ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS paypilot_webhook_events_tenant_received
  ON paypilot_webhook_events (tenant_id, received_at DESC);
