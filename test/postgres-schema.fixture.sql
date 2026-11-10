-- Disposable PostgreSQL integration-test schema; never use this fixture in production.
CREATE TABLE public.paypilot_tenants (
  tenant_id text PRIMARY KEY,
  tenant_kind text NOT NULL CHECK (tenant_kind IN ('private','judge_demo')),
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.paypilot_tenant_state (
  tenant_id text PRIMARY KEY REFERENCES public.paypilot_tenants(tenant_id),
  state jsonb NOT NULL DEFAULT '{"drafts":[],"orders":[],"actions":[],"invoices":[],"settings":{},"proposals":[]}'::jsonb,
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.paypilot_paypal_order_routes (
  order_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES public.paypilot_tenants(tenant_id),
  invoice_id text NOT NULL,
  proposal_id text,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','pending','captured','failed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.paypilot_sessions (
  session_hash text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES public.paypilot_tenants(tenant_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE TABLE public.paypilot_webhook_events (
  event_id text PRIMARY KEY,
  tenant_id text REFERENCES public.paypilot_tenants(tenant_id),
  order_id text,
  event_type text NOT NULL,
  payload_sha256 text,
  status text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error_code text
);
CREATE ROLE paypilot_staging_runtime LOGIN PASSWORD 'test-only-password' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE paypilot_account_provisioner LOGIN PASSWORD 'test-only-provisioner' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT USAGE ON SCHEMA public TO paypilot_staging_runtime, paypilot_account_provisioner;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO paypilot_staging_runtime;
INSERT INTO public.paypilot_tenants (tenant_id,tenant_kind) VALUES ('rls-test-tenant-a','judge_demo'),('rls-test-tenant-b','judge_demo'),('rls-test-private','private');
INSERT INTO public.paypilot_tenant_state (tenant_id,state,version) VALUES
 ('rls-test-tenant-a','{"invoices":[{"id":"invoice-a","client":"Tenant A fixture","number":"A-001","amount":125,"currency":"USD","issueDate":"2026-11-01","dueDate":"2026-11-15","status":"open","disputed":false}]}'::jsonb,0),
 ('rls-test-tenant-b','{"invoices":[{"id":"invoice-b","client":"Tenant B fixture","number":"B-001","amount":250,"currency":"USD","issueDate":"2026-11-01","dueDate":"2026-11-16","status":"open","disputed":false}]}'::jsonb,0),
 ('rls-test-private','{"invoices":[{"id":"invoice-private","client":"Private tenant fixture","number":"P-001","amount":125,"currency":"USD","issueDate":"2026-11-01","dueDate":"2026-11-16","status":"open","disputed":false}],"orders":[{"orderId":"ORDER-PRIVATE-TEST-01","invoiceId":"invoice-private","amount":125,"currency":"USD","status":"created","createdAt":"2026-11-09T00:00:00.000Z"}]}'::jsonb,0);
INSERT INTO public.paypilot_sessions (session_hash,tenant_id,expires_at) VALUES
 (repeat('a',64),'rls-test-tenant-a',now()+interval '1 day'),
 (repeat('b',64),'rls-test-tenant-b',now()+interval '1 day');
INSERT INTO public.paypilot_paypal_order_routes (order_id,tenant_id,invoice_id) VALUES
 ('order-a','rls-test-tenant-a','invoice-a'),('order-b','rls-test-tenant-b','invoice-b'),('ORDER-PRIVATE-TEST-01','rls-test-private','invoice-private');
INSERT INTO public.paypilot_webhook_events (event_id,tenant_id,order_id,event_type,status) VALUES
 ('event-a','rls-test-tenant-a','order-a','PAYMENT.CAPTURE.COMPLETED','received'),
 ('event-b','rls-test-tenant-b','order-b','PAYMENT.CAPTURE.COMPLETED','received');
