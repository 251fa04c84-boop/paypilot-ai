-- Run as paypilot_staging_runtime after applying migrations/002_tenant_rls.sql.
-- Two fixture tenants are created by test/postgres-schema.fixture.sql.
-- Expected: tenant A sees only A, cannot update B, and cannot insert a row for B.
BEGIN;
SELECT set_config('app.tenant_id', 'rls-test-tenant-a', true);
DO $$
DECLARE visible_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM public.paypilot_tenants;
  IF visible_count <> 1 THEN RAISE EXCEPTION 'tenant A saw % tenant rows, expected 1', visible_count; END IF;

  SELECT count(*) INTO visible_count FROM public.paypilot_tenant_state WHERE tenant_id = 'rls-test-tenant-b';
  IF visible_count <> 0 THEN RAISE EXCEPTION 'tenant A can read tenant B state'; END IF;
  SELECT count(*) INTO visible_count FROM public.paypilot_sessions WHERE tenant_id = 'rls-test-tenant-b';
  IF visible_count <> 0 THEN RAISE EXCEPTION 'tenant A can read tenant B sessions'; END IF;
  SELECT count(*) INTO visible_count FROM public.paypilot_paypal_order_routes WHERE tenant_id = 'rls-test-tenant-b';
  IF visible_count <> 0 THEN RAISE EXCEPTION 'tenant A can read tenant B order routes'; END IF;
  SELECT count(*) INTO visible_count FROM public.paypilot_webhook_events WHERE tenant_id = 'rls-test-tenant-b';
  IF visible_count <> 0 THEN RAISE EXCEPTION 'tenant A can read tenant B webhook events'; END IF;

  UPDATE public.paypilot_tenant_state
    SET state = jsonb_set(state, '{invoices}', '[]'::jsonb)
    WHERE tenant_id = 'rls-test-tenant-b';
  GET DIAGNOSTICS visible_count = ROW_COUNT;
  IF visible_count <> 0 THEN RAISE EXCEPTION 'tenant A modified tenant B state'; END IF;

  BEGIN
    INSERT INTO public.paypilot_tenant_state (tenant_id, state, version)
    VALUES ('rls-test-tenant-b', '{}'::jsonb, 0);
    RAISE EXCEPTION 'tenant A inserted tenant B state';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;
ROLLBACK;
