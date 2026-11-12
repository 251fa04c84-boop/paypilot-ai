-- Remove direct application-role access to password-reset records.
-- Reset issuance/completion remains available only through the narrowly scoped
-- SECURITY DEFINER functions granted to the account provisioner.
BEGIN;

DO $reset_table_lockdown$
DECLARE
  role_name TEXT;
  reset_table REGCLASS := to_regclass('public.paypilot_password_reset_tokens');
  legacy_table REGCLASS := to_regclass('public.paypilot_password_resets');
BEGIN
  IF reset_table IS NULL THEN
    RAISE EXCEPTION 'paypilot_password_reset_tokens is missing; apply the private-account migration first';
  END IF;

  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.paypilot_password_reset_tokens FROM PUBLIC';
  FOREACH role_name IN ARRAY ARRAY[
    'paypilot_staging_runtime',
    'paypilot_runtime',
    'paypilot_provisioner',
    'paypilot_account_provisioner'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.paypilot_password_reset_tokens FROM %I', role_name);
    END IF;
  END LOOP;

  EXECUTE 'ALTER TABLE public.paypilot_password_reset_tokens ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.paypilot_password_reset_tokens FORCE ROW LEVEL SECURITY';

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'paypilot_password_reset_tokens'
      AND policyname = 'paypilot_password_reset_tokens_tenant_scope'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY paypilot_password_reset_tokens_tenant_scope
      ON public.paypilot_password_reset_tokens
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''))
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''))
    $policy$;
  END IF;

  -- Retire direct access to the legacy reset table too, if an older database
  -- still has it. It is not part of the current reset flow.
  IF legacy_table IS NOT NULL THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.paypilot_password_resets FROM PUBLIC';
    FOREACH role_name IN ARRAY ARRAY[
      'paypilot_staging_runtime',
      'paypilot_runtime',
      'paypilot_provisioner',
      'paypilot_account_provisioner'
    ] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.paypilot_password_resets FROM %I', role_name);
      END IF;
    END LOOP;

    EXECUTE 'ALTER TABLE public.paypilot_password_resets ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.paypilot_password_resets FORCE ROW LEVEL SECURITY';
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'paypilot_password_resets'
        AND policyname = 'paypilot_password_resets_deny_direct_access'
    ) THEN
      EXECUTE $policy$
        CREATE POLICY paypilot_password_resets_deny_direct_access
        ON public.paypilot_password_resets
        USING (false)
        WITH CHECK (false)
      $policy$;
    END IF;
  END IF;
END
$reset_table_lockdown$;

COMMIT;
