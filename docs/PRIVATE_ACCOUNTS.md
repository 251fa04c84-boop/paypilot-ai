# Private account access

This feature is implemented on the `codex/paypilot-promise-to-pay-v1` branch. It is deliberately opt-in: the shared judge demo remains available without login, while a valid account cookie switches API requests into that account's private PostgreSQL tenant.

## Required server configuration

- `PG_STORAGE_MODE=judge_demo`
- `DATABASE_URL`: runtime PostgreSQL role used for tenant transactions and session persistence
- `JUDGE_DEMO_TENANT_ID`: already-provisioned shared judge tenant
- `ACCOUNT_PROVISIONING_DATABASE_URL`: separate least-privilege role for account/tenant creation and account lookup
- `SESSION_SECRET`: at least 32 bytes of high-entropy secret; generate with `openssl rand -base64 48`

The provisioning role needs:
- `INSERT` on `paypilot_tenants`, `paypilot_tenant_state`, and `paypilot_users`
- `SELECT` on `paypilot_tenants` and `paypilot_users`

It must not be a superuser. The runtime role separately needs its existing tenant-state and session privileges plus permission to execute `paypilot_resolve_session(text, timestamptz)`.

Apply `db/migrations/20261110_private_accounts.sql` to the target PostgreSQL database using a migration owner before enabling account access. Do not point this migration at production until the database target has been independently confirmed.

The app checks provisioning grants and exposes readiness at `GET /api/health` as `auth.enabled`. A configured URL alone is not sufficient. The UI hides/disables account access if the readiness check fails.

## HTTP endpoints

- `POST /api/auth/register` — accepts `{ "email": "...", "password": "..." }`; atomically creates a private tenant, empty tenant state and user, then signs the user in.
- `POST /api/auth/login` — accepts email/password and returns a signed session cookie.
- `POST /api/auth/logout` — revokes the persisted session and clears the cookie.
- `GET /api/auth/me` — validates the cookie and returns the authenticated user and tenant identifier.

Passwords must be 12–128 characters. Passwords are stored as salted Node.js scrypt hashes (N=16384, r=8, p=1, 64-byte output); plaintext passwords are never persisted. Sessions use random 256-bit IDs, HMAC signatures, SHA-256 session hashes in PostgreSQL, seven-day expiry, HttpOnly, SameSite=Lax and Secure cookies in production.

## Tenant boundary

- With no session cookie, the API uses only the server-configured judge-demo tenant.
- With a cookie, the server verifies its HMAC and expiry, resolves its hash against the persisted session record, requires a linked user, and uses only the returned tenant ID.
- An invalid, expired, revoked or legacy userless session is rejected with 401; it never falls back to the shared demo.
- Client-supplied tenant IDs are ignored.
- The public demo remains read-only in production. Authenticated private tenants may create and manage their own invoices.
- Registration creates a new empty tenant; no shared demo data is copied into it.

## Current limitations

- Email ownership is not verified because no email delivery provider is configured. Treat the email as a login identifier only.
- Password reset, password change, MFA and account recovery are not included.
- Login throttling is an in-memory sliding-window limit (12 attempts per IP and 6 per normalized identity per 15 minutes). It is suitable as a single-instance baseline but resets on restart and is not shared across multiple app instances; replace it with a shared persistent limiter before multi-instance production use.
- A live service is not account-enabled merely because this branch contains the code. Confirm the target DB migration, separate role grants, secret configuration and `/api/health` readiness before deployment.
