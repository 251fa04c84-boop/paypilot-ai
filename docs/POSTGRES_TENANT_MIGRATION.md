# PayPilot AI — PostgreSQL persistence and tenant-isolation release plan

Status: **design gate; runtime remains on the restricted shared JSON demo store.**

This document is an implementation contract, not a claim that persistence or multi-tenancy is already working. The current application is a single-process Node HTTP server. Route handlers close over one mutable `db` object, and `store.save()` writes a synchronous JSON snapshot. The existing `lib/session.js` token primitives and `db/schema.sql` tables are preparatory and are not wired into request handling.

## Non-negotiable safety boundary

- Keep the current public judge demo isolated as one explicit `judge_demo` tenant.
- Never import the current shared demo invoices into a private tenant.
- Never infer a tenant from an invoice ID, request body, query parameter, or caller-supplied header.
- A private tenant must be resolved only from a verified server-side session.
- PayPal webhooks must resolve the tenant from the persisted PayPal order route, after signature verification. A webhook payload must not choose its tenant.
- Never initiate a PayPal capture until the order-to-tenant and invoice-to-tenant relationship has been revalidated.
- No cross-tenant query may omit its `tenant_id` predicate. Add database row-level security as defense in depth using a non-owner application role; the schema owner connection must not be used by the runtime.
- Do not enable the new backend on the public Render service until the integration and release gates below pass.

## Why a simple Neon connection is unsafe

The current server stores domain state in one mutable object. A database adapter that merely writes the whole JSON snapshot on every `save()` would introduce lost updates under concurrent requests and could overwrite another tenant's state. PayPal capture and webhook processing also span external network calls, so a database write after an external capture must be idempotent and recoverable. The runtime needs request-scoped tenant state, explicit transaction boundaries, optimistic concurrency or row locking, and a durable order-routing record.

## Target architecture

1. **Identity:** retain the existing signed, opaque `pp_session` cookie format, but persist only the SHA-256 session hash. Enforce expiry, revocation, rotation on authentication, HttpOnly, Secure in production, SameSite=Lax, and CSRF/origin protections on mutations.
2. **Tenant resolution:** middleware verifies the cookie and resolves `session_hash -> tenant_id` from `paypilot_sessions`; suspended/closed tenants and expired/revoked sessions fail closed. The browser never supplies an authoritative tenant ID.
3. **Repository boundary:** replace direct global `db` access with a request-scoped repository. Every read/write accepts the resolved tenant context and scopes by tenant ID. No process-global mutable customer state.
4. **Persistence:** use PostgreSQL transactions for invoice, draft, proposal, audit, session and payment-route state. Use a pooled Neon connection for application traffic and a direct connection for schema migrations. Add bounded pool size, query timeouts and graceful shutdown.
5. **Concurrency:** use version-checked updates or row locks for approval decisions, proposal execution, order claims and webhook idempotency. A stale write returns a conflict and never silently overwrites newer state.
6. **PayPal:** persist a unique order ID to tenant/invoice/proposal mapping before the buyer is redirected. Verify the PayPal webhook signature first, then look up the stored route, then verify the completed capture against invoice ID, amount and currency. Store event IDs with a unique constraint so retries are idempotent.
7. **Judge demo:** create or seed exactly one `judge_demo` tenant with synthetic records. Keep judge access clearly separate from private user sign-in. If the judge demo remains unauthenticated, it must be a deliberately restricted, isolated demo tenant—not a path into private tenant data.

## Implementation sequence

### Phase A — Repository and schema contract
- Keep `db/schema.sql` as the source of truth and add versioned migrations.
- Add a repository interface and PostgreSQL implementation without changing the production backend selector.
- Add a limited application database role; the runtime must not connect as the schema owner.
- Add database constraints/indexes for session expiry, tenant-state versioning, unique PayPal order IDs and unique webhook event IDs.
- Test migration up/down or documented forward-only rollback behavior on a disposable Neon branch.

### Phase B — Request-scoped identity and isolation
- Add sign-up/sign-in or a clearly documented invitation flow before private tenant access is exposed.
- Add login/logout/session-revocation endpoints and session persistence.
- Resolve tenant context once per request; reject missing/invalid context on private routes.
- Add cross-tenant tests for invoice reads, edits, exports, proposals, actions, order lookups and webhook routing.
- Keep judge-demo routes explicitly allowlisted and bound to the one judge tenant.

### Phase C — Transactional domain operations
- Move each route from global arrays to the tenant repository.
- Make all state-changing handlers await durable commits.
- Make proposal approval/execution and invoice snapshot revalidation atomic.
- Add webhook event deduplication and payment-order claims in the same transaction as state transitions.
- Add retry-safe recovery for a process restart between PayPal capture and local commit.

### Phase D — Data migration and rollout
- Do not migrate the shared demo JSON file into a private tenant.
- Seed synthetic judge data into the judge tenant through an explicit idempotent command.
- Back up the current demo state before any cutover; retain a tested rollback to the restricted JSON demo.
- Deploy to a preview/staging service first with `STORAGE_BACKEND=postgres`.
- Verify persistence across process restart, multiple concurrent requests and multiple service instances.
- Enable the PostgreSQL backend on the public service only after all release gates pass.

## Required automated verification

- Tenant A cannot read, mutate, export, approve, execute, or pay Tenant B's invoice, even when given Tenant B's object IDs.
- Session tokens are tamper-resistant, expire, can be revoked, and database rows contain only token hashes.
- Missing, invalid, expired, revoked, suspended, and closed contexts fail closed.
- Two simultaneous edits cannot silently overwrite each other; stale snapshot approvals are cancelled/rejected.
- Duplicate PayPal webhook delivery is idempotent across process restarts and concurrent workers.
- A webhook for an unknown order is recorded as ignored without selecting a tenant from payload data.
- A payment order cannot be routed to an invoice in another tenant.
- Capture verification checks PayPal status, invoice reference, amount and currency before marking paid.
- App restart preserves invoices, proposals, sessions, order mappings, webhook event IDs and audit history.
- The existing 109-test suite remains green, plus new repository/integration tests against a disposable PostgreSQL database.

## Current release decision

**Do not enable PostgreSQL mode or claim multi-tenancy yet.** The existing Neon tables are currently empty, and the application still runs on the shared JSON store. The next implementation PR must include runtime integration and tests—not only schema creation—before the release status can change.
