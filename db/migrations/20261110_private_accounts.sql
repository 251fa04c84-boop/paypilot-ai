-- Private account/session support. Apply only after reviewing the target DB and role.
-- The migration is additive: it does not import or alter shared judge-demo state.
BEGIN;

CREATE TABLE IF NOT EXISTS public.paypilot_users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL UNIQUE REFERENCES public.paypilot_tenants(tenant_id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  normalized_email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL CHECK (length(password_hash) BETWEEN 40 AND 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (normalized_email = lower(trim(normalized_email)))
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

COMMIT;
