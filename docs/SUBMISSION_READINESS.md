# PayPilot AI — Submission Readiness

Last verified: 12 November 2026, 05:24 UTC (read-only staging checks)

## Judge links

- Staging demo: https://paypilot-ai-pg-staging.onrender.com/
- Public source repository: https://github.com/251fa04c84-boop/paypilot-ai
- Staging implementation branch: https://github.com/251fa04c84-boop/paypilot-ai/tree/codex/paypilot-real-postgres-staging
- Demo walkthrough: [docs/DEMO_GUIDE.md](DEMO_GUIDE.md)
- Under-three-minute recording script: [docs/FINAL_DEMO_SCRIPT.md](FINAL_DEMO_SCRIPT.md)

## Deployment status — do not confuse source with live

- Render staging service: `paypilot-ai-pg-staging` (Singapore, free tier).
- Configured branch: `codex/paypilot-real-postgres-staging`; auto-deploy is enabled.
- At the 05:23 UTC verification, Render's latest live deployment was still commit `e178346c1d3cc452f08325a8698edce4718b8d2a`.
- The staging branch had advanced to commit `95c60916a3179f56b5d1f70bad2d341da5996238` (nine commits ahead of the deployed commit). The later changes include the shared-demo disclosure banner in `public/index.html` and a password-reset database migration.
- The deployed homepage did not yet display the shared-demo disclosure banner, even though it exists in the branch source. Treat the banner as pending until a later Render deployment and live browser check confirm it.
- The first read-only request returned HTTP 503 while the free service was waking. A retry succeeded; Render logs show the Node process listening on port 10000. This is consistent with a free-tier cold start, not proof of an application crash.

## Live checks completed at 05:23 UTC

- `GET /api/health`: successful; `ok: true`.
- Health reported PostgreSQL tenant-scoped storage, Gemini configured, PayPal Sandbox configured, signed-session auth enabled and Brevo configured.
- `GET /api/safety-lab`: **22/22 passed**, zero failed, zero live provider calls, zero model calls and zero mutations.
- `GET /api/trust`: human approval, 30-minute approval TTL, server-side capture verification, signed webhook verification, tenant-scoped storage, signed sessions and audit log reported configured/enabled.
- Trust correctly reports that live PayPal webhook delivery and transactional email delivery are **not independently verified**.
- Trust also reports public judge-demo mutations are enabled. The public demo uses shared synthetic records; do not enter personal, confidential or real customer data.
- `GET /api/intelligence/overview`: seven open demo invoices, five flagged for human review, and three local-ledger consistency anomalies (one orphan order and two stale open orders). These are demo ledger signals, not fraud determinations or proof of real payment failures.
- Homepage shell loaded successfully after the wake-up retry. The deployed build still needs the later shared-demo banner before the judge-facing disclosure is complete.

## Security migration — intentionally not applied

PR #56 added `db/migrations/20261112_password_reset_least_privilege.sql` and its disposable-CI integration checks. The source change is merged, but the migration has **not** been applied to the live Neon staging database.

A read-only inspection of the live database showed that the connection role `paypilot_app` owns the password-reset tables/functions and is also the database owner with `BYPASSRLS`. Revoking ordinary table grants and forcing RLS does not constrain a BYPASSRLS owner. The merged migration therefore does not establish the intended live security boundary. Do not apply it as-is. A safe redesign must transfer ownership to a dedicated restricted function-owner role, constrain runtime access, and be tested on a disposable Neon branch before any staging application.

## What the project demonstrates

- Portfolio-level invoice prioritisation with explainable deterministic evidence.
- Optional Gemini explanations and message drafting; AI cannot decide payment status or bypass policy.
- Human approval before allowlisted recovery actions, with expiry and revalidation.
- PayPal Orders v2 Sandbox integration and server-side capture checks bound to the stored order, invoice, amount and currency.
- Tenant-scoped PostgreSQL persistence and signed private sessions.
- Deterministic Risk Radar, payment-ledger consistency checks, read-only recovery simulation, CSV reconciliation preview, audit export and Trust Centre.
- A 22-check deterministic Safety Lab. It is a policy regression suite, not a penetration test.

## Verified vs. not verified

| Area | Current evidence |
|---|---|
| Staging health | HTTP success after free-tier wake-up; health reports `ok: true` |
| Safety Lab | 22/22 deterministic checks passed live |
| PostgreSQL and tenant isolation | CI integration tests passed, including tenant isolation, concurrent writes and cross-connection persistence |
| PayPal Sandbox capture | A prior operator-reported Sandbox checkout was completed and verified; no new payment was initiated during this audit |
| PayPal webhook | Signature/replay logic is covered by tests and webhook ID is configured; live delivery is not independently verified |
| Password-reset email | Brevo is configured; inbox delivery is not independently verified |
| Password-reset table least privilege | Source/CI migration exists but is not safe for the observed live owner role and has not been applied |
| Shared-demo disclosure | Present in staging source; not yet visible in the currently deployed homepage |
| Production | Separate production service was not accessed or modified |

## Submission checklist

1. Record the actual staging app on the intended device. Show the real app working; do not use fabricated screenshots or mock footage.
2. Keep the video under three minutes, upload it publicly to YouTube, and use only original or properly licensed audio/assets.
3. Add the public video URL, source repository, staging demo, project description and tools used to the Devpost submission.
4. The entrant must personally review the official rules, complete required fields and make any legal eligibility/originality attestations. Do not claim submission until Devpost confirms it.

Official deadline: 12 November 2026 at 12:00 PM Pacific Time (13 November 2026 at 01:30 AM India Standard Time).

## Safety boundaries during this audit

No production operation, payment, email send, password reset, demo seed/reset, invoice mutation or live database migration was performed. All live checks above were read-only.
