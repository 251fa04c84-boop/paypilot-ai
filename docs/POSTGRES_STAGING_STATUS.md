# Real PostgreSQL staging gate

## Current staging setup
- Dedicated Neon branch: `paypilot-upgrade-staging`
- Runtime role: `paypilot_staging_runtime` (non-owner, no superuser, no BYPASSRLS)
- RLS is enabled and forced on all five tenant tables on the isolated staging branch.
- The policy key is transaction-local `app.tenant_id`; requests must never accept tenant IDs from user-controlled headers or bodies.

## Important integration gap
The existing `server.js` still uses the synchronous JSON store. Do not configure the Render service to use this database and do not merge this branch yet. The repository currently performs some session and webhook operations outside tenant-scoped transactions; those paths must be refactored before the RLS migration can be considered fully application-compatible.

## Verified staging test
Connected as `paypilot_staging_runtime`, set `app.tenant_id=rls-test-tenant-a`, and verified:
- only tenant A's tenant and state rows were visible;
- tenant B's state was invisible;
- an UPDATE targeting tenant B affected zero rows;
- the final SELECT still returned only tenant A.

The companion SQL assertion file is `test/postgres-rls.integration.sql`. It expects the two named fixture tenants to exist and runs inside a rollback-only transaction.
