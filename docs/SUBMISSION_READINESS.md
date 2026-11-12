# PayPilot AI — Submission Readiness

Last verified: 12 November 2026, 05:27 UTC (live staging API + browser smoke test)

## Judge links

- Staging demo: https://paypilot-ai-pg-staging.onrender.com/
- Public source repository: https://github.com/251fa04c84-boop/paypilot-ai
- Staging implementation branch: https://github.com/251fa04c84-boop/paypilot-ai/tree/codex/paypilot-real-postgres-staging
- Judge walkthrough: [docs/DEMO_GUIDE.md](DEMO_GUIDE.md)
- Under-three-minute recording script: [docs/FINAL_DEMO_SCRIPT.md](FINAL_DEMO_SCRIPT.md)

## Current deployment

- Render service: `paypilot-ai-pg-staging` (Singapore, free tier).
- Configured branch: `codex/paypilot-real-postgres-staging`.
- Latest live deployment: `dep-dbqkras9v7es73ctidrg`, commit `f996742252c22026c6f5155a4bf62af3718dc4a2`.
- Build succeeded and Node 22 started successfully.
- The visible shared-demo disclosure banner is present in the deployed browser UI.
- Staging `APP_BASE_URL` has been explicitly set to `https://paypilot-ai-pg-staging.onrender.com`, so newly generated payment/reminder links use the staging origin. Historical proposals already stored with the previous preview URL were not edited. A new proposal was not generated just to test the link, because that would mutate shared demo data.
- The free-tier service may return a temporary 503 while waking. A retry succeeded; this audit did not find evidence of a persistent crash.

## Live judge walkthrough — 05:26 UTC

A real browser smoke test loaded the public app and navigated Overview, Command Centre and Trust Centre. It did not sign in, submit forms, click action/approval/payment/reminder/seed/reset controls, or change data.

- Shared-demo warning: visibly rendered below the navigation.
- Overview: 7 open invoices, 7 overdue invoices, 0 awaiting review, 1 paused dispute.
- Financial snapshot: USD 6,440 outstanding/overdue; USD 1,200 in the 30+ days at-risk bucket; USD 950 disputed; USD 0 PayPal-verified captures; 2 operator-confirmed reminders.
- Command Centre: 22/22 deterministic Safety Lab checks passed; the page states no AI calls, no provider calls and no mutations.
- Trust Centre: tenant-scoped PostgreSQL, signed private sessions, human approval, server-side capture verification, webhook signature verification and audit log are configured.
- Trust caveats are visible: live PayPal webhook delivery and email inbox delivery are not independently verified; public demo actions can change shared synthetic records.
- API smoke checks for health, invoices, recovery queue, summary, risk, Safety Lab, read-only simulation, Trust Centre, activity and proposals completed without errors. These were GET/read-only requests.

## Security migration — intentionally not applied

PR #56 added `db/migrations/20261112_password_reset_least_privilege.sql` and disposable-CI checks. The source change is merged, but the migration has **not** been applied to the live Neon staging database.

Read-only inspection found that `paypilot_app` owns the password-reset tables/functions and is also the database owner with `BYPASSRLS`. Ordinary grant revocation and forced RLS do not constrain a BYPASSRLS owner. Do not apply the merged migration as-is. A safe redesign must transfer ownership to a dedicated restricted function-owner role, constrain runtime access, and be validated on a disposable Neon branch first.

## Current payment-evidence snapshot

The live staging portfolio currently shows 7 open invoices, USD 6,440 outstanding/overdue, USD 950 disputed, and **USD 0 / 0 PayPal-verified captures**. Acme Studio D-1001 remains open and has a stale Sandbox order that requires provider-state review. Do not describe the current demo as having completed a live Sandbox capture. The Safety Lab's capture checks use deterministic fixtures and do not call PayPal.

## What PayPilot demonstrates

- Portfolio-level receivables prioritisation with explainable deterministic evidence.
- Optional Gemini interpretation/drafting; AI cannot set payment status or bypass policy.
- Human approval before allowlisted actions, with 30-minute expiry and snapshot revalidation.
- PayPal Orders v2 Sandbox integration and server-side capture verification bound to stored order ID, invoice, amount and currency.
- Tenant-scoped PostgreSQL persistence and signed private sessions.
- Deterministic Risk Radar, payment-ledger consistency checks, read-only recovery simulation, CSV reconciliation preview, audit export and Trust Centre.
- A 22-check deterministic Safety Lab. It is a policy regression suite, not a penetration test.

## Verified vs. not verified

| Area | Evidence/status |
|---|---|
| Staging deployment | Latest Render deployment live on commit `f996742`; build succeeded |
| Browser experience | Shared-data warning visible; Overview, Command Centre and Trust Centre navigated successfully |
| Safety Lab | 22/22 deterministic checks passed live |
| PostgreSQL and tenant isolation | CI integration passed tenant isolation, concurrent writes and cross-connection persistence |
| PayPal Sandbox capture | Current live staging snapshot shows zero verified captures and Acme Studio D-1001 remains open. A prior operator-reported test is not reflected in the current staging ledger; no new payment was initiated during this audit |
| PayPal webhook | Signature/replay logic tested and webhook ID configured; live delivery not independently verified |
| Password-reset email | Brevo configured; inbox delivery not independently verified |
| Password-reset table least privilege | Source/CI migration exists but is unsafe for the observed live owner role and remains unapplied |
| New payment/reminder link origin | `APP_BASE_URL` set to staging; no new proposal was generated to avoid shared-demo mutation |
| Production | Separate production service was not accessed or modified |

## Submission checklist

1. Record the actual staging app on the intended device. Show the real app functioning; do not use fabricated screenshots or mock footage.
2. Keep the video under three minutes, upload it publicly to YouTube, and use only original or properly licensed audio/assets.
3. Add the public video URL, source repository, staging demo, project description and tools used to the Devpost submission.
4. The entrant must personally review the official rules, complete required fields and make any legal eligibility/originality attestations. Do not claim submission until Devpost confirms it.

Official deadline: 12 November 2026 at 12:00 PM Pacific Time (13 November 2026 at 01:30 AM India Standard Time).

## Safety boundaries during this audit

No production operation, payment, email send, password reset, demo seed/reset, invoice mutation or live database migration was performed. All live application checks were read-only; the only staging configuration change was setting the non-secret `APP_BASE_URL` to the staging origin.
