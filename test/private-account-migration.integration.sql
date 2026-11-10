-- Validate the additive private-account migration in a disposable CI database.
BEGIN;

INSERT INTO public.paypilot_tenants (tenant_id, tenant_kind)
VALUES ('private-account-test', 'private');
INSERT INTO public.paypilot_tenant_state (tenant_id, state, version)
VALUES ('private-account-test', '{}'::jsonb, 0);
INSERT INTO public.paypilot_users (tenant_id, email, email_normalized, password_hash)
VALUES ('private-account-test', 'ci-account@example.test', 'ci-account@example.test',
        'scrypt$16384$8$1$' || repeat('a', 32) || '$' || repeat('b', 128))
RETURNING user_id;
INSERT INTO public.paypilot_sessions (session_hash, tenant_id, user_id, expires_at)
SELECT repeat('c', 64), tenant_id, user_id, now() + interval '1 day'
FROM public.paypilot_users WHERE email_normalized = 'ci-account@example.test';

DO $$
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
END $$;

SET ROLE paypilot_account_provisioner;
DO $$
DECLARE found_count integer;
BEGIN
  SELECT count(*) INTO found_count
  FROM public.paypilot_find_user_by_email('ci-account@example.test');
  IF found_count <> 1 THEN RAISE EXCEPTION 'private account lookup returned % rows', found_count; END IF;
END $$;
RESET ROLE;

SET ROLE paypilot_staging_runtime;
DO $$
DECLARE resolved_tenant text; resolved_user uuid;
BEGIN
  SELECT tenant_id, user_id INTO resolved_tenant, resolved_user
  FROM public.paypilot_resolve_session(repeat('c', 64), now());
  IF resolved_tenant <> 'private-account-test' OR resolved_user IS NULL THEN
    RAISE EXCEPTION 'private session resolver failed after migration';
  END IF;
END $$;
RESET ROLE;

ROLLBACK;
