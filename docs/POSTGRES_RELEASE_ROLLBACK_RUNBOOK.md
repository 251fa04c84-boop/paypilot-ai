# PostgreSQL release and rollback runbook

## Current gate
The request-scoped PostgreSQL judge-demo mode is implemented and covered by real PostgreSQL CI. The live Render service is still on `main`, uses the JSON store, and has not been changed. There is no separate PayPilot Render staging service in the workspace.

## Before any Render rollout
1. Create or designate a separate staging web service on the PostgreSQL integration branch. Do not repoint the live service to this branch.
2. Provision a dedicated judge-demo tenant using an administrator connection.
3. Configure `DATABASE_URL` with the non-owner runtime role (never the database owner), `PG_STORAGE_MODE=judge_demo`, and `JUDGE_DEMO_TENANT_ID`.
4. Configure PayPal Sandbox client credentials and `PAYPAL_WEBHOOK_ID`; verify the webhook endpoint in the PayPal Sandbox dashboard.
5. Verify the runtime role has no superuser, BYPASSRLS, CREATEDB, or CREATEROLE privileges and has only the required table grants and bootstrap-function EXECUTE grants.
6. Deploy the staging service, wait for `/api/health`, then exercise invoice creation, sandbox order creation, capture, webhook replay, restart persistence, and cross-tenant denial.
7. Take a database backup/snapshot and record the current deploy ID before any production rollout.

## Rollback safety
- Never disable RLS as a rollback shortcut.
- Never switch a service back to the JSON store after PostgreSQL writes have begun unless a verified export/restore has copied the complete tenant state and audit/payment history into a durable store.
- The pre-PostgreSQL live deployment cannot read PostgreSQL state. A simple Render rollback to that deployment would therefore show stale/missing data and is not an acceptable production rollback.
- A safe production rollback requires a previously deployed PG-compatible application release and an unchanged backward-compatible schema, or a tested data export/restore path. Neither has been completed for the live service.
- The integration suite verifies database transaction rollback (a failed transaction leaves no partial write) and simulated process restart using a fresh pool/app instance. It is not a substitute for a Render deployment rollback rehearsal.

## Current decision
Do not trigger a production deploy yet. The remaining operational gate is a separately provisioned staging service and a tested PG-compatible release rollback. No production service or live payment was modified as part of this PR.
