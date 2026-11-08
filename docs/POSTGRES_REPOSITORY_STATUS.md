# PostgreSQL repository implementation status

This branch adds a PostgreSQL repository boundary and request-scoped tenant-context resolver. It does **not** switch the live PayPilot deployment from the shared JSON demo store.

## Included

- Tenant transactions set transaction-local `app.tenant_id`, verify an active tenant, lock the tenant-state row, and update JSONB state with a version predicate.
- Session resolution accepts only a signed `pp_session` cookie and a matching, active, unexpired, non-revoked database session. Only the SHA-256 session hash is queried.
- Judge-demo context is created from server configuration, never from request headers or body data.
- PayPal order routes have unique durable mappings; webhook event inserts are idempotent through the database primary key.
- Unit tests exercise tenant context, transaction setup, rollback, row locking and versioned writes.

## Not yet safe to enable

The current `server.js` route handlers still use the legacy global JSON store. This repository is a tested integration boundary, not a completed conversion of every invoice/proposal/payment route. Before enabling it, all route handlers must receive the resolved context and use repository transactions; PayPal order creation must persist its route before redirect; verified webhooks must resolve the tenant from that route; and an application database role with RLS policies must be provisioned.

The live Render service remains on its existing JSON-backed demo until those gates and live staging tests pass. Do not set a PostgreSQL feature flag on the public service from this branch.
