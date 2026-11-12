-- Apply only after the base PayPilot tenant tables and grants exist.
-- Every request transaction must set app.tenant_id before accessing tenant-owned rows.
-- The runtime connection must use a non-owner role without BYPASSRLS.

ALTER TABLE public.paypilot_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paypilot_tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY paypilot_tenant_scope ON public.paypilot_tenants
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

ALTER TABLE public.paypilot_tenant_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paypilot_tenant_state FORCE ROW LEVEL SECURITY;
CREATE POLICY paypilot_state_scope ON public.paypilot_tenant_state
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

ALTER TABLE public.paypilot_paypal_order_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paypilot_paypal_order_routes FORCE ROW LEVEL SECURITY;
CREATE POLICY paypilot_order_route_scope ON public.paypilot_paypal_order_routes
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

ALTER TABLE public.paypilot_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paypilot_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY paypilot_session_scope ON public.paypilot_sessions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

ALTER TABLE public.paypilot_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paypilot_webhook_events FORCE ROW LEVEL SECURITY;
CREATE POLICY paypilot_webhook_scope ON public.paypilot_webhook_events
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
