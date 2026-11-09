-- These SECURITY DEFINER functions are the only cross-tenant bootstrap lookups.
-- They are owned by the migration/admin role and expose only the minimum routing tuple.
-- The application runtime role must not own these functions or have BYPASSRLS.

CREATE OR REPLACE FUNCTION public.paypilot_resolve_session(p_session_hash text, p_now timestamptz)
RETURNS TABLE (tenant_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
  SELECT s.tenant_id
  FROM public.paypilot_sessions AS s
  JOIN public.paypilot_tenants AS t ON t.tenant_id = s.tenant_id
  WHERE s.session_hash = p_session_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > p_now
    AND t.status = 'active'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.paypilot_resolve_order_route(p_order_id text)
RETURNS TABLE (order_id text, tenant_id text, invoice_id text, proposal_id text, status text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
  SELECT r.order_id, r.tenant_id, r.invoice_id, r.proposal_id, r.status
  FROM public.paypilot_paypal_order_routes AS r
  WHERE r.order_id = p_order_id
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.paypilot_resolve_session(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.paypilot_resolve_order_route(text) FROM PUBLIC;
DO $
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paypilot_staging_runtime') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.paypilot_resolve_session(text, timestamptz) TO paypilot_staging_runtime';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.paypilot_resolve_order_route(text) TO paypilot_staging_runtime';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paypilot_runtime') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.paypilot_resolve_session(text, timestamptz) TO paypilot_runtime';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.paypilot_resolve_order_route(text) TO paypilot_runtime';
  END IF;
END $;
