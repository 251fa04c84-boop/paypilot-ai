# PayPilot AI — Submission Readiness

Last verified: 11 November 2026

## Public staging demo

- URL: https://paypilot-ai-pg-staging.onrender.com/
- Environment: Render free-tier staging service, Singapore region
- Branch: `codex/paypilot-real-postgres-staging`
- Deployed commit: `bcc66518afa69979fa308fdd0e85895cd004de7c`
- Deployment: Render reports the deploy as **live**.
- Production remains separate and was not changed: https://paypilot-ai-1qw8.onrender.com/

## What was verified

- Public staging homepage loads successfully in a browser; no visible page error.
- `GET /api/health` returned HTTP 200 with `ok: true`.
- Health reports PostgreSQL tenant-scoped storage, Gemini configured, PayPal Sandbox configured, and private-account auth enabled.
- Public judge-demo workflow mutations are enabled on staging only; demo-admin controls remain disabled. The interactive workflow can change shared synthetic demo records, and the public reset control is disabled.
- The Gemini assistant passed a live read-only browser test: it summarized overdue and disputed demo invoices with evidence and did not create proposals, approvals, payment links, or execute actions.
- One live portfolio-sweep test succeeded and staged a single pending reminder-draft proposal for Greenleaf Co (demo); no proposal was approved or executed and no payment was created.
- GitHub Actions PostgreSQL integration workflow run 43035812286 completed successfully. It passed application unit tests, schema/runtime-role setup, RLS policy checks, restricted lookup functions, migrations, private account/session checks, tenant isolation, concurrent writes, cross-connection persistence, HTTP route integration, and cleanup.
- No production service or production database was modified.

## Remaining external verification

1. **Password-reset email:** implemented with Brevo and Resend adapters, but no provider is configured on staging. Health currently reports `email.configured: false`. To enable it, configure `BREVO_API_KEY` and a verified `EMAIL_FROM` directly in the Render staging environment. Never commit or paste the API key into chat.
2. **PayPal webhook delivery:** the webhook endpoint and signature/replay handling are implemented and covered by automated tests. The latest read-only lookup against the staging Sandbox credentials found no record of the previously simulated event (event lookup returned 404; event listing returned zero events). Therefore live delivery to this staging app is **not currently verified**. Do not describe it as verified based only on mocked tests or a queued simulator message.
3. **Judge interaction:** the staging preview now has the controlled judge-demo workflow enabled. It uses shared synthetic records; judge actions can change those records, and public reset is disabled. No production data is exposed.

## Safe submission claims

PayPilot is an evidence-first receivables recovery demo that uses deterministic invoice rules, optional Gemini explanations, human approval gates, PayPal Sandbox payment verification, tenant-scoped PostgreSQL persistence, and an audit trail.

Do not claim real-money processing, proven recovery-rate improvements, live webhook delivery to this staging app, or working password-reset email until those items are separately verified.

## Submission links

- Staging demo: https://paypilot-ai-pg-staging.onrender.com/
- Source repository: https://github.com/251fa04c84-boop/paypilot-ai
- Staging implementation PR: https://github.com/251fa04c84-boop/paypilot-ai/pull/28
