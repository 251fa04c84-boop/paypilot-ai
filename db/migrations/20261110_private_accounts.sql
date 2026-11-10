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
SET search_path = pg_catalog, public
SET row_security = off
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

REVOKE ALL ON FUNCTION public.paypilot_resolve_session(text, timestamptz) FROM PUBLIC;
DO $session_grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paypilot_staging_runtime') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.paypilot_resolve_session(text, timestamptz) TO paypilot_staging_runtime';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paypilot_runtime') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.paypilot_resolve_session(text, timestamptz) TO paypilot_runtime';
  END IF;
END
$session_grants$;



-- Account login must find a user before its tenant context is known. Keep
-- this cross-tenant lookup inside a narrowly scoped SECURITY DEFINER function;
-- do not weaken FORCE RLS or grant the app direct tenant-table bypass.
CREATE OR REPLACE FUNCTION public.paypilot_find_user_by_email(p_email_normalized text)
RETURNS TABLE (user_id uuid, tenant_id text, email text, password_hash text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
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
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paypilot_runtime') THEN
    EXECUTE 'GRANT SELECT ON TABLE public.paypilot_sessions TO paypilot_runtime';
  END IF;
END
$grant$;

-- One-time password reset tokens are stored only as SHA-256 hashes.
CREATE TABLE IF NOT EXISTS public.paypilot_password_reset_tokens (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}),
  tenant_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.paypilot_users(user_id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id) REFERENCES public.paypilot_tenants(tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS paypilot_password_reset_user_expiry
  ON public.paypilot_password_reset_tokens (user_id, expires_at)
  WHERE used_at IS NULL;
REVOKE ALL ON TABLE public.paypilot_password_reset_tokens FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.paypilot_create_password_reset(
  p_email_normalized TEXT, p_token_hash TEXT, p_expires_at TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $
DECLARE target_user public.paypilot_users%ROWTYPE;
BEGIN
  IF p_token_hash !~ '^[a-f0-9]{64} OR p_expires_at <= now() OR p_expires_at > now() + interval '31 minutes' THEN
    RAISE EXCEPTION 'Invalid password reset request';
  END IF;
  SELECT u.* INTO target_user
  FROM public.paypilot_users u
  JOIN public.paypilot_tenants t ON t.tenant_id = u.tenant_id
  WHERE u.email_normalized = lower(trim(p_email_normalized))
    AND t.status = 'active' AND t.tenant_kind = 'private'
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  DELETE FROM public.paypilot_password_reset_tokens
  WHERE user_id = target_user.user_id AND used_at IS NULL;
  INSERT INTO public.paypilot_password_reset_tokens(token_hash, tenant_id, user_id, expires_at)
  VALUES (p_token_hash, target_user.tenant_id, target_user.user_id, p_expires_at);
  RETURN target_user.email;
END;
$;

CREATE OR REPLACE FUNCTION public.paypilot_complete_password_reset(
  p_token_hash TEXT, p_password_hash TEXT, p_now TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $
DECLARE target_user_id UUID;
BEGIN
  IF p_token_hash !~ '^[a-f0-9]{64} OR length(p_password_hash) < 40 OR length(p_password_hash) > 300 THEN
    RETURN FALSE;
  END IF;
  UPDATE public.paypilot_password_reset_tokens t
  SET used_at = p_now
  FROM public.paypilot_users u
  WHERE t.token_hash = p_token_hash
    AND t.user_id = u.user_id
    AND t.used_at IS NULL
    AND t.expires_at > p_now
  RETURNING t.user_id INTO target_user_id;
  IF target_user_id IS NULL THEN RETURN FALSE; END IF;
  UPDATE public.paypilot_users
  SET password_hash = p_password_hash, updated_at = p_now
  WHERE user_id = target_user_id;
  UPDATE public.paypilot_sessions
  SET revoked_at = p_now
  WHERE user_id = target_user_id AND revoked_at IS NULL;
  RETURN TRUE;
END;
$;

REVOKE ALL ON FUNCTION public.paypilot_create_password_reset(text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.paypilot_complete_password_reset(text, text, timestamptz) FROM PUBLIC;
DO $reset_grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paypilot_account_provisioner') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.paypilot_create_password_reset(text, text, timestamptz) TO paypilot_account_provisioner';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.paypilot_complete_password_reset(text, text, timestamptz) TO paypilot_account_provisioner';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paypilot_provisioner') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.paypilot_create_password_reset(text, text, timestamptz) TO paypilot_provisioner';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.paypilot_complete_password_reset(text, text, timestamptz) TO paypilot_provisioner';
  END IF;
END
$reset_grants$;

COMMIT;
