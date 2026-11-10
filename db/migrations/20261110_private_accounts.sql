-- Private account/session support. Apply only after reviewing the target DB and role.
-- The migration is additive: it does not import or alter shared judge-demo state.
BEGIN;

CREATE TABLE IF NOT EXISTS public.paypilot_users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL UNIQUE REFERENCES public.paypilot_tenants(tenant_id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL CHECK (length(password_hash) BETWEEN 40 AND 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (email_normalized = lower(trim(email_normalized)))
);

ALTER TABLE public.paypilot_sessions
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.paypilot_users(user_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS paypilot_sessions_user_expiry
  ON public.paypilot_sessions (user_id, expires_at)
  WHERE revoked_at IS NULL;

-- The old resolver returned only tenant_id. Drop it before changing its return shape.
DROP FUNCTION IF EXISTS public.paypilot_resolve_session(text, timestamptz);

CREATE FUNCTION public.paypilot_resolve_session(p_session_hash text, p_now timestamptz)
RETURNS TABLE (tenant_id text, user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.tenant_id, s.user_id
  FROM public.paypilot_sessions AS s
  JOIN public.paypilot_tenants AS t ON t.tenant_id = s.tenant_id
  WHERE s.session_hash = p_session_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > p_now
    AND t.status = 'active'
    AND (t.tenant_kind = 'judge_demo' OR s.user_id IS NOT NULL)
  LIMIT 1;
$$;


-- Account login must find a user before its tenant context is known. Keep
-- this cross-tenant lookup inside a narrowly scoped SECURITY DEFINER function;
-- do not weaken FORCE RLS or grant the app direct tenant-table bypass.
CREATE OR REPLACE FUNCTION public.paypilot_find_user_by_email(p_email_normalized text)
RETURNS TABLE (user_id uuid, tenant_id text, email text, password_hash text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.user_id, u.tenant_id, u.email, u.password_hash
  FROM public.paypilot_users AS u
  JOIN public.paypilot_tenants AS t ON t.tenant_id = u.tenant_id
  WHERE u.email_normalized = lower(trim(p_email_normalized))
    AND t.status = 'active'
    AND t.tenant_kind = 'private'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.paypilot_find_user_by_email(text) FROM PUBLIC;
DO $lookup_grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paypilot_provisioner') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.paypilot_find_user_by_email(text) TO paypilot_provisioner';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paypilot_account_provisioner') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.paypilot_find_user_by_email(text) TO paypilot_account_provisioner';
  END IF;
END
$lookup_grants$;

-- The staging runtime updates a session during logout. PostgreSQL also
-- requires SELECT on columns used by UPDATE predicates/RETURNING.
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paypilot_staging_runtime') THEN
    EXECUTE 'GRANT SELECT ON TABLE public.paypilot_sessions TO paypilot_staging_runtime';
  END IF;
END
$grant$;

COMMIT;
