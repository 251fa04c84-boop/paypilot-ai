# PostgreSQL staging status

## Implemented in this branch
- Every API route now runs inside a request-scoped PostgreSQL tenant transaction when `PG_STORAGE_MODE=judge_demo`.
- The tenant ID is server-configured through `JUDGE_DEMO_TENANT_ID`; request headers and bodies cannot select a tenant.
- A request-local store adapter preserves the existing route business logic without a process-global mutable tenant database.
- Tenant state updates use a row lock and version-checked JSONB write.
- Forced-RLS-safe SECURITY DEFINER bootstrap functions resolve a signed session hash and an opaque PayPal order ID; direct table access remains tenant-scoped. The functions expose only the minimum tenant-routing tuple.
- PayPal order routes and webhook replay records are persisted in the same transaction as tenant state.
- Render Blueprint now declares the PostgreSQL driver, build install, and required judge-demo environment variables. This is configuration in the PR only; the live Render service has not been changed.

## Verified in GitHub Actions
Workflow: [PostgreSQL integration gates](https://github.com/251fa04c84-boop/paypilot-ai/actions/workflows/postgres-integration.yml)

Run `42634858795` passed on commit `24a36d43729d1b7a221a1a3a5df38315f4b046eb`:
- 130 application tests passed; one environment-gated integration test was skipped in the unit-test pass.
- PostgreSQL 16 fixture and non-owner runtime role created.
- RLS migration, restricted bootstrap lookup functions, and pending PayPal order-status migration applied; cross-tenant read/write checks and signed-session/order-ID bootstrap resolution passed.
- Concurrent row updates and fresh-connection persistence passed.
- Dedicated real-PostgreSQL HTTP integration passed: transaction rollback leaves no partial state, tenant A/B route isolation, invoice persistence, PayPal order-route persistence, simultaneous capture requests causing one PayPal capture, duplicate webhook handling, and a new pool/app instance reading persisted state after simulated process restart.

## Verified on isolated Neon staging
Branch: `paypilot-upgrade-staging` (`br-soft-mountain-a1yhgu3p`).
Runtime role: `paypilot_staging_runtime` (non-owner, no superuser, no BYPASSRLS).
- Provisioned a dedicated `judge_demo` tenant `pp-judge-demo-staging`.
- As the restricted runtime role, successfully wrote and read an order-route row, a webhook-event row, and the corresponding tenant-state JSONB update under transaction-local `app.tenant_id`.
- These records are staging fixtures only, not production customer/payment data.

## Explicit limitations / not production-ready
- This release mode is the public judge-demo tenant only. It does not yet expose private user signup/login routes or bind signed sessions to private tenants.
- Webhook/capture routing is tenant-scoped for this configured judge tenant. Multi-tenant private PayPal callback resolution still needs a narrowly scoped bootstrap lookup and corresponding app flow.
- The app holds the tenant transaction/row lock while route handlers await external AI or PayPal calls. This preserves serialized state changes but can increase lock duration; production hardening should move network calls outside short DB transactions with durable state transitions/outbox patterns.
- No Render environment variables were changed, no production deployment was performed, and no live PayPal payment was initiated.
- Do not set the live service to PostgreSQL mode until the staging tenant, restricted-role connection string, webhook configuration, and rollback procedure are deliberately configured and a deployment smoke test passes.
