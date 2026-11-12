-- Validate private-account security and restricted password-reset execution in disposable CI PostgreSQL.
BEGIN;

INSERT INTO public.paypilot_tenants (tenant_id, tenant_kind)
VALUES ('private-account-test', 'private');
INSERT INTO public.paypilot_tenant_state (tenant_id, state, version)
VALUES ('private-account-test', '{}'::jsonb, 0);
INSERT INTO public.paypilot_users (tenant_id, email, email_normalized, password_hash)
VALUES ('private-account-test', 'ci-account@example.test', 'ci-account@example.test',
        'scrypt$16384$8$1$' || repeat('a', 32) || '$' || repeat('b', 128));
INSERT INTO public.paypilot_sessions (session_hash, tenant_id, user_id, expires_at)
SELECT repeat('c', 64), tenant_id, user_id, now() + interval '1 day'
FROM public.paypilot_users WHERE email_normalized = 'ci-account@example.test';

DO $assertions$
DECLARE
  reset_rls_enabled boolean;
  reset_rls_forced boolean;
  owner_login boolean;
  owner_bypass boolean;
  owner_super boolean;
  owner_createdb boolean;
  owner_createrole boolean;
  table_owner text;
  function_owner text;
  function_config text[];
BEGIN
  IF has_table_privilege('paypilot_account_provisioner', 'public.paypilot_users', 'SELECT') THEN
    RAISE EXCEPTION 'account provisioner must not have direct user-table SELECT';
  END IF;
  IF has_function_privilege('paypilot_staging_runtime', 'public.paypilot_find_user_by_email(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'runtime must not execute cross-tenant account lookup';
  END IF;
  IF NOT has_function_privilege('paypilot_account_provisioner', 'public.paypilot_find_user_by_email(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'account provisioner is missing restricted lookup execution';
  END IF;
  IF NOT has_function_privilege('paypilot_staging_runtime', 'public.paypilot_resolve_session(text,timestamp with time zone)', 'EXECUTE') THEN
    RAISE EXCEPTION 'runtime is missing session resolver execution after migration';
  END IF;

  SELECT rolcanlogin, rolbypassrls, rolsuper, rolcreatedb, rolcreaterole
  INTO owner_login, owner_bypass, owner_super, owner_createdb, owner_createrole
  FROM pg_catalog.pg_roles WHERE rolname = 'paypilot_reset_executor';
  IF owner_login IS DISTINCT FROM FALSE
     OR owner_bypass IS DISTINCT FROM TRUE
     OR owner_super IS DISTINCT FROM FALSE
     OR owner_createdb IS DISTINCT FROM FALSE
     OR owner_createrole IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'reset executor must be NOLOGIN, BYPASSRLS, and otherwise unprivileged';
  END IF;

  SELECT pg_catalog.pg_get_userbyid(c.relowner)
  INTO table_owner
  FROM pg_catalog.pg_class c
  WHERE c.oid = 'public.paypilot_password_reset_tokens'::regclass;
  IF table_owner <> 'paypilot_reset_executor' THEN
    RAISE EXCEPTION 'reset token table owner is %, expected paypilot_reset_executor', table_owner;
  END IF;

  SELECT pg_catalog.pg_get_userbyid(p.proowner), p.proconfig
  INTO function_owner, function_config
  FROM pg_catalog.pg_proc p
  WHERE p.oid = 'public.paypilot_complete_password_reset(text,text,timestamp with time zone)'::regprocedure;
  IF function_owner <> 'paypilot_reset_executor' THEN
    RAISE EXCEPTION 'password reset function owner is %, expected paypilot_reset_executor', function_owner;
  END IF;
  IF NOT ('search_path=pg_catalog, pg_temp' = ANY(function_config))
     OR NOT ('row_security=off' = ANY(function_config)) THEN
    RAISE EXCEPTION 'password reset function must pin search_path and explicitly handle RLS';
  END IF;

  IF has_table_privilege('paypilot_staging_runtime', 'public.paypilot_password_reset_tokens', 'SELECT')
     OR has_table_privilege('paypilot_staging_runtime', 'public.paypilot_password_reset_tokens', 'INSERT')
     OR has_table_privilege('paypilot_staging_runtime', 'public.paypilot_password_reset_tokens', 'UPDATE')
     OR has_table_privilege('paypilot_staging_runtime', 'public.paypilot_password_reset_tokens', 'DELETE') THEN
    RAISE EXCEPTION 'runtime must not have direct password-reset token table privileges';
  END IF;
  IF has_table_privilege('paypilot_account_provisioner', 'public.paypilot_password_reset_tokens', 'SELECT')
     OR has_table_privilege('paypilot_account_provisioner', 'public.paypilot_password_reset_tokens', 'INSERT')
     OR has_table_privilege('paypilot_account_provisioner', 'public.paypilot_password_reset_tokens', 'UPDATE')
     OR has_table_privilege('paypilot_account_provisioner', 'public.paypilot_password_reset_tokens', 'DELETE') THEN
    RAISE EXCEPTION 'account provisioner must use reset functions, not direct token-table access';
  END IF;
  IF has_function_privilege('paypilot_staging_runtime', 'public.paypilot_create_password_reset(text,text,timestamp with time zone)', 'EXECUTE') THEN
    RAISE EXCEPTION 'runtime must not execute password-reset bootstrap functions';
  END IF;
  IF NOT has_function_privilege('paypilot_account_provisioner', 'public.paypilot_create_password_reset(text,text,timestamp with time zone)', 'EXECUTE')
     OR NOT has_function_privilege('paypilot_account_provisioner', 'public.paypilot_complete_password_reset(text,text,timestamp with time zone)', 'EXECUTE')
     OR NOT has_function_privilege('paypilot_account_provisioner', 'public.paypilot_invalidate_password_reset(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'account provisioner is missing password-reset function execution';
  END IF;
  IF pg_catalog.pg_has_role('paypilot_account_provisioner', 'paypilot_reset_executor', 'MEMBER') THEN
    RAISE EXCEPTION 'account provisioner must not be a member of the reset function owner role';
  END IF;

  SELECT c.relrowsecurity, c.relforcerowsecurity
  INTO reset_rls_enabled, reset_rls_forced
  FROM pg_catalog.pg_class c
  WHERE c.oid = 'public.paypilot_password_reset_tokens'::regclass;
  IF reset_rls_enabled IS NOT TRUE OR reset_rls_forced IS NOT TRUE THEN
    RAISE EXCEPTION 'password reset token table must retain ENABLE and FORCE ROW LEVEL SECURITY';
  END IF;

  IF to_regclass('public.paypilot_password_resets') IS NOT NULL
     AND (
       has_table_privilege('paypilot_staging_runtime', 'public.paypilot_password_resets', 'SELECT')
       OR has_table_privilege('paypilot_staging_runtime', 'public.paypilot_password_resets', 'INSERT')
       OR has_table_privilege('paypilot_staging_runtime', 'public.paypilot_password_resets', 'UPDATE')
       OR has_table_privilege('paypilot_staging_runtime', 'public.paypilot_password_resets', 'DELETE')
     ) THEN
    RAISE EXCEPTION 'runtime must not have direct privileges on legacy reset table';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='paypilot_users' AND column_name='password_updated_at'
  ) THEN
    RAISE EXCEPTION 'password_updated_at must exist for reset completion';
  END IF;
END
$assertions$;

SET ROLE paypilot_account_provisioner;
DO $lookup$
DECLARE found_count integer;
BEGIN
  SELECT count(*) INTO found_count
  FROM public.paypilot_find_user_by_email('ci-account@example.test');
  IF found_count <> 1 THEN
    RAISE EXCEPTION 'private account lookup returned % rows', found_count;
  END IF;
END
$lookup$;
RESET ROLE;

SET ROLE paypilot_staging_runtime;
DO $session$
DECLARE resolved_tenant text; resolved_user uuid;
BEGIN
  SELECT tenant_id, user_id INTO resolved_tenant, resolved_user
  FROM public.paypilot_resolve_session(repeat('c', 64), now());
  IF resolved_tenant <> 'private-account-test' OR resolved_user IS NULL THEN
    RAISE EXCEPTION 'private session resolver failed after migration';
  END IF;
END
$session$;
RESET ROLE;

SET ROLE paypilot_account_provisioner;
DO $reset$
DECLARE
  reset_email text;
  completed boolean;
  invalidated boolean;
  reset_at timestamptz := now();
BEGIN
  SELECT public.paypilot_create_password_reset(
    'ci-account@example.test', repeat('d',64), reset_at + interval '30 minutes'
  ) INTO reset_email;
  IF reset_email <> 'ci-account@example.test' THEN
    RAISE EXCEPTION 'password reset recipient lookup failed';
  END IF;

  SELECT public.paypilot_complete_password_reset(
    repeat('d',64), 'scrypt$16384$8$1$' || repeat('e',32) || '$' || repeat('f',128), reset_at
  ) INTO completed;
  IF completed IS NOT TRUE THEN
    RAISE EXCEPTION 'valid password reset token was not accepted';
  END IF;

  SELECT public.paypilot_invalidate_password_reset(repeat('d',64)) INTO invalidated;
  IF invalidated IS NOT FALSE THEN
    RAISE EXCEPTION 'used password reset token must not be reusable';
  END IF;

  SELECT public.paypilot_create_password_reset(
    'ci-account@example.test', repeat('e',64), reset_at + interval '30 minutes'
  ) INTO reset_email;
  IF reset_email <> 'ci-account@example.test' THEN
    RAISE EXCEPTION 'second password reset recipient lookup failed';
  END IF;
  SELECT public.paypilot_invalidate_password_reset(repeat('e',64)) INTO invalidated;
  IF invalidated IS NOT TRUE THEN
    RAISE EXCEPTION 'unused password reset token could not be invalidated';
  END IF;
  SELECT public.paypilot_complete_password_reset(
    repeat('e',64), 'scrypt$16384$8$1$' || repeat('g',32) || '$' || repeat('h',128), reset_at
  ) INTO completed;
  IF completed IS NOT FALSE THEN
    RAISE EXCEPTION 'invalidated reset token was accepted';
  END IF;
END
$reset$;
RESET ROLE;

DO $outcome$
DECLARE password_updated timestamptz;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.paypilot_sessions
    WHERE session_hash = repeat('c',64) AND revoked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'password reset must revoke existing sessions';
  END IF;
  SELECT password_updated_at INTO password_updated
  FROM public.paypilot_users
  WHERE email_normalized = 'ci-account@example.test';
  IF password_updated IS NULL THEN
    RAISE EXCEPTION 'password_updated_at was not updated by reset completion';
  END IF;
END
$outcome$;

ROLLBACK;
