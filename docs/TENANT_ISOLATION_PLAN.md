# PayPilot AI — tenant isolation implementation plan

**Status: not implemented.** The hosted judge demo currently uses one shared JSON database without accounts or tenant boundaries. This document records the required design before code is changed; it is not a claim that the application is multi-tenant or production-ready.

## Why a small cookie patch is not enough

The current HTTP handler closes over one `store` and one `db`. Invoice, draft, proposal, order, settings, and audit routes all read or mutate those shared objects. PayPal webhooks arrive server-to-server and do not carry the browser's session cookie. Simply adding a session cookie or filtering `GET /api/invoices` would therefore leave cross-session writes, approvals, and payment settlement possible.

## Required architecture

1. **Explicit request context:** resolve a signed, opaque session identifier at the HTTP boundary and pass a request-scoped repository/context to every route. Avoid implicit global mutable `db` state.
2. **Session security:** generate identifiers with a cryptographically secure random source; sign cookies with HMAC-SHA-256 using a mandatory production secret; compare signatures in constant time; set `HttpOnly`, `Secure` on HTTPS, `SameSite=Lax`, `Path=/`, and bounded expiry. Never place invoice/customer data in the cookie.
3. **Repository isolation:** store each tenant's invoices, drafts, proposals, audit entries, and settings under its own namespace. Every lookup by invoice, draft, or proposal ID must be scoped to the resolved tenant, including nested routes and assistant tools.
4. **PayPal webhook routing:** persist a server-side mapping from PayPal order ID to tenant ID and invoice ID when creating an order. After verifying the PayPal signature and webhook ID, resolve the mapping and settle only that tenant's order. Never trust tenant identifiers supplied by webhook payload metadata alone.
5. **Idempotency and concurrency:** enforce unique order/event IDs and atomic state transitions. The in-memory inflight sets are process-local and are not sufficient for multiple instances.
6. **Resource limits:** bound tenant count, per-tenant storage, cookie lifetime, and stale-session cleanup. Do not silently create unlimited durable records from anonymous traffic.
7. **Migration:** preserve the existing judge scenario as an explicit public demo tenant. Do not migrate the current shared database into a user tenant or expose its records to newly created sessions.
8. **Operational storage:** replace the ephemeral JSON-file store with a transactional persistent database before claiming durable multi-instance tenancy.

## Acceptance tests required before enabling it

- Two independent cookie jars cannot list, read, mutate, approve, execute, or export each other's records.
- Guessing another tenant's invoice, draft, or proposal ID returns not-found and has no side effects.
- A signed PayPal webhook settles only the tenant mapped to that order; unknown, replayed, or mismatched orders do not mutate another tenant.
- Cookie tampering, expiry, missing production secret, and invalid signatures fail closed.
- Concurrent duplicate capture/webhook requests cannot double-settle or duplicate audit transitions.
- Restart and multi-instance tests prove that sessions, order mappings, and idempotency survive process replacement.
- Existing public judge-demo walkthrough and Sandbox payment flow continue to work independently of private tenants.

## Release gate

Do not enable private tenant creation or describe PayPilot as multi-tenant until all acceptance tests pass against the persistent repository implementation. Keep the current app labelled as a restricted shared demo, and do not collect real customer data or real funds.

## Infrastructure bootstrap (2026-11-07)

- A dedicated PayPilot Neon Postgres project has been created under the account's confirmed Free plan, in `aws-ap-southeast-1`, with a 0.25 CU compute ceiling. This is separate from the user's TraceBack AI and RAJ projects.
- The DDL in `db/schema.sql` has been applied successfully to the new `paypilot` database and is committed in the repository.
- Tables cover tenant identity/state, hashed session references, PayPal order-to-tenant routing, and globally unique webhook event IDs.
- **Application integration is not complete.** The running app still uses the legacy shared JSON store. No tenant sessions or customer records have been created, and the live Render deployment has not been changed.
- The next implementation phase must add a request-scoped Postgres repository, signed opaque cookies, transaction/locking behavior, webhook routing through `paypilot_paypal_order_routes`, and cross-tenant acceptance tests. Do not claim multi-tenancy until those tests pass.
