-- Move password-reset SECURITY DEFINER execution away from the broad database-owner role.
-- Apply only to the staging branch after reviewing the target database and role.
-- paypilot_reset_executor is NOLOGIN and has BYPASSRLS only because its functions
-- must update reset tokens and revoke sessions across tenant RLS boundaries.
-- Its grants are limited to the reset token table and the exact user/session columns
-- required by these three functions. Only paypilot_account_provisioner can EXECUTE them.

BEGIN;

-- Older private-account installs named this timestamp column updated_at.
-- Current staging uses password_updated_at. Keep both compatible while making
-- the reset-specific timestamp explicit.
ALTER TABLE public.paypilot_users
  ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $role$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'paypilot_reset_executor' AND rolsuper
  ) THEN
    RAISE EXCEPTION 'paypilot_reset_executor must never be a superuser; review the existing role before migration';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'paypilot_reset_executor') THEN
    EXECUTE 'CREATE ROLE paypilot_reset_executor NOLOGIN NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS';
  ELSE
    EXECUTE 'ALTER ROLE paypilot_reset_executor NOLOGIN NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS';
  END IF;
END
$role$;

-- The live staging migration connection is paypilot_app, which must be able to
-- transfer object ownership. CI runs as postgres and does not need this grant.
DO $membership$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'paypilot_app') THEN
    EXECUTE 'GRANT paypilot_reset_executor TO paypilot_app WITH INHERIT FALSE, SET TRUE';
  END IF;
END
$membership$;

GRANT USAGE, CREATE ON SCHEMA public TO paypilot_reset_executor;
GRANT SELECT (user_id, tenant_id, email, email_normalized)
  ON public.paypilot_users TO paypilot_reset_executor;
GRANT UPDATE (password_hash, password_updated_at)
  ON public.paypilot_users TO paypilot_reset_executor;
GRANT SELECT (tenant_id, status, tenant_kind)
  ON public.paypilot_tenants TO paypilot_reset_executor;
GRANT SELECT (user_id, revoked_at)
  ON public.paypilot_sessions TO paypilot_reset_executor;
GRANT UPDATE (revoked_at)
  ON public.paypilot_sessions TO paypilot_reset_executor;

CREATE OR REPLACE FUNCTION public.paypilot_create_password_reset(
  p_email_normalized TEXT, p_token_hash TEXT, p_expires_at TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
DECLARE
  target_user_id UUID;
  target_tenant_id TEXT;
  target_email TEXT;
BEGIN
  IF p_email_normalized IS NULL OR pg_catalog.btrim(p_email_normalized) = ''
     OR p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_expires_at IS NULL OR p_expires_at <= pg_catalog.now()
     OR p_expires_at > pg_catalog.now() + interval '31 minutes' THEN
    RAISE EXCEPTION 'Invalid password reset request';
  END IF;

  SELECT u.user_id, u.tenant_id, u.email
  INTO target_user_id, target_tenant_id, target_email
  FROM public.paypilot_users AS u
  JOIN public.paypilot_tenants AS t ON t.tenant_id = u.tenant_id
  WHERE u.email_normalized = pg_catalog.lower(pg_catalog.btrim(p_email_normalized))
    AND t.status = 'active'
    AND t.tenant_kind = 'private'
  LIMIT 1;

  IF target_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  DELETE FROM public.paypilot_password_reset_tokens
  WHERE user_id = target_user_id AND used_at IS NULL;

  INSERT INTO public.paypilot_password_reset_tokens(token_hash, tenant_id, user_id, expires_at)
  VALUES (p_token_hash, target_tenant_id, target_user_id, p_expires_at);

  RETURN target_email;
END;
$function$;

CREATE OR REPLACE FUNCTION public.paypilot_complete_password_reset(
  p_token_hash TEXT, p_password_hash TEXT, p_now TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
DECLARE
  target_user_id UUID;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_password_hash IS NULL
     OR pg_catalog.length(p_password_hash) < 40
     OR pg_catalog.length(p_password_hash) > 300 THEN
    RETURN FALSE;
  END IF;

  UPDATE public.paypilot_password_reset_tokens AS t
  SET used_at = p_now
  FROM public.paypilot_users AS u
  WHERE t.token_hash = p_token_hash
    AND t.user_id = u.user_id
    AND t.used_at IS NULL
    AND t.expires_at > p_now
  RETURNING t.user_id INTO target_user_id;

  IF target_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE public.paypilot_users
  SET password_hash = p_password_hash,
      password_updated_at = p_now
  WHERE user_id = target_user_id;

  UPDATE public.paypilot_sessions
  SET revoked_at = p_now
  WHERE user_id = target_user_id
    AND revoked_at IS NULL;

  RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.paypilot_invalidate_password_reset(p_token_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN FALSE;
  END IF;

  UPDATE public.paypilot_password_reset_tokens
  SET used_at = pg_catalog.now()
  WHERE token_hash = p_token_hash
    AND used_at IS NULL;

  RETURN FOUND;
END;
$function$;

-- The role must own the objects used by its SECURITY DEFINER functions.
ALTER TABLE public.paypilot_password_reset_tokens OWNER TO paypilot_reset_executor;
ALTER TABLE IF EXISTS public.paypilot_password_resets OWNER TO paypilot_reset_executor;
ALTER FUNCTION public.paypilot_create_password_reset(TEXT, TEXT, TIMESTAMPTZ) OWNER TO paypilot_reset_executor;
ALTER FUNCTION public.paypilot_complete_password_reset(TEXT, TEXT, TIMESTAMPTZ) OWNER TO paypilot_reset_executor;
ALTER FUNCTION public.paypilot_invalidate_password_reset(TEXT) OWNER TO paypilot_reset_executor;
REVOKE CREATE ON SCHEMA public FROM paypilot_reset_executor;

-- Switch to the non-login function owner for its object ACLs and RLS policies.
SET LOCAL ROLE paypilot_reset_executor;

-- Keep direct table access denied even if a future grant is accidentally added.
-- The BYPASSRLS function owner can still operate through the narrowly scoped functions.
ALTER TABLE public.paypilot_password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paypilot_password_reset_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS paypilot_password_reset_tokens_tenant_scope ON public.paypilot_password_reset_tokens;
DROP POLICY IF EXISTS paypilot_password_reset_tokens_deny_direct_access ON public.paypilot_password_reset_tokens;
CREATE POLICY paypilot_password_reset_tokens_deny_direct_access
  ON public.paypilot_password_reset_tokens
  USING (false) WITH CHECK (false);

DO $legacy_rls$
BEGIN
  IF to_regclass('public.paypilot_password_resets') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.paypilot_password_resets ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.paypilot_password_resets FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS paypilot_password_resets_deny_direct_access ON public.paypilot_password_resets';
    EXECUTE 'CREATE POLICY paypilot_password_resets_deny_direct_access ON public.paypilot_password_resets USING (false) WITH CHECK (false)';
  END IF;
END
$legacy_rls$;

-- Remove direct table access from every application/provisioning role. The
-- non-login function owner is the only principal that can access token rows.
REVOKE ALL PRIVILEGES ON TABLE public.paypilot_password_reset_tokens FROM PUBLIC;
DO $table_revokes$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'paypilot_app',
    'paypilot_staging_runtime',
    'paypilot_runtime',
    'paypilot_runtime_v2',
    'paypilot_provisioner',
    'paypilot_account_provisioner',
    'pp_session_entropy_a',
    'pp_session_entropy_b',
    'pp_session_entropy_c',
    'pp_session_entropy_d'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.paypilot_password_reset_tokens FROM %I', role_name);
      IF to_regclass('public.paypilot_password_resets') IS NOT NULL THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.paypilot_password_resets FROM %I', role_name);
      END IF;
    END IF;
  END LOOP;
END
$table_revokes$;

-- Functions are not public APIs. Only the account-provisioning connection can
-- invoke them; the general application runtime cannot reset passwords directly.
REVOKE ALL PRIVILEGES ON FUNCTION public.paypilot_create_password_reset(TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.paypilot_complete_password_reset(TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.paypilot_invalidate_password_reset(TEXT) FROM PUBLIC;

DO $function_revokes$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'paypilot_app',
    'paypilot_staging_runtime',
    'paypilot_runtime',
    'paypilot_runtime_v2',
    'paypilot_provisioner'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.paypilot_create_password_reset(TEXT, TEXT, TIMESTAMPTZ) FROM %I', role_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.paypilot_complete_password_reset(TEXT, TEXT, TIMESTAMPTZ) FROM %I', role_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.paypilot_invalidate_password_reset(TEXT) FROM %I', role_name);
    END IF;
  END LOOP;
END
$function_revokes$;

GRANT EXECUTE ON FUNCTION public.paypilot_create_password_reset(TEXT, TEXT, TIMESTAMPTZ) TO paypilot_account_provisioner;
GRANT EXECUTE ON FUNCTION public.paypilot_complete_password_reset(TEXT, TEXT, TIMESTAMPTZ) TO paypilot_account_provisioner;
GRANT EXECUTE ON FUNCTION public.paypilot_invalidate_password_reset(TEXT) TO paypilot_account_provisioner;

-- The Neon administration role receives only an explicit SET-capable, non-inheriting
-- membership so it can transfer ownership and administer the reset objects. It does
-- not receive ADMIN OPTION. Render runtime/provisioner roles are never members.
DO $membership_assert$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles r ON r.oid = m.member
    WHERE m.roleid = 'paypilot_reset_executor'::regrole
      AND r.rolname = 'paypilot_app'
      AND (m.admin_option OR m.inherit_option OR NOT m.set_option)
  ) THEN
    RAISE EXCEPTION 'paypilot_app reset-owner membership must be non-inheriting, non-admin, and explicitly SET-capable';
  END IF;
END
$membership_assert$;

COMMIT;
