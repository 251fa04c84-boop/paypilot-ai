# PayPilot AI — Submission Readiness

Last verified: 12 November 2026, 06:06 UTC (live staging API, browser walkthrough, PayPal simulator signature and CI)

## Judge links

- Staging demo: https://paypilot-ai-pg-staging.onrender.com/
- Public source repository: https://github.com/251fa04c84-boop/paypilot-ai
- Staging implementation branch: https://github.com/251fa04c84-boop/paypilot-ai/tree/codex/paypilot-real-postgres-staging
- Judge walkthrough: [docs/DEMO_GUIDE.md](DEMO_GUIDE.md)
- Under-three-minute recording script: [docs/FINAL_DEMO_SCRIPT.md](FINAL_DEMO_SCRIPT.md)

## Current deployment

- Render service: `paypilot-ai-pg-staging` (Singapore, free tier).
- Configured branch: `codex/paypilot-real-postgres-staging`.
- Latest live deployment: `dep-dbqle2bbc2fs73do0feg`, commit `f7cb136306ddf7234fcc51d065efa7692d7a79f3`.
- Build succeeded and Node 22 started successfully.
- The visible shared-demo disclosure banner is present in the deployed browser UI.
- Staging `APP_BASE_URL` has been explicitly set to `https://paypilot-ai-pg-staging.onrender.com`, so newly generated payment/reminder links use the staging origin. Historical proposals already stored with the previous preview URL were not edited. A new proposal was not generated just to test the link, because that would mutate shared demo data.
- The free-tier service may return a temporary 503 while waking. A retry succeeded; this audit did not find evidence of a persistent crash.
- PayPal simulator verification timestamp: `2026-11-12T06:03:40.832Z`. The mock event is not a real capture and is not treated as one.
- The latest deployment includes the assistant-routing fix: generic cash-flow advice now reaches optional Gemini rather than being misclassified as a deterministic portfolio-summary request.

## Live judge walkthrough — 06:06 UTC

A real browser smoke test loaded the public app and navigated Overview, Command Centre and Trust Centre. It did not sign in, submit forms, click action/approval/payment/reminder/seed/reset controls, or change data.

- Shared-demo warning: visibly rendered below the navigation.
- Overview: 7 open invoices, 7 overdue invoices, 0 awaiting review, 1 paused dispute.
- Financial snapshot: USD 6,440 outstanding/overdue; USD 1,200 in the 30+ days at-risk bucket; USD 950 disputed; USD 0 PayPal-verified captures; 2 operator-confirmed reminders.
- Command Centre: 22/22 deterministic Safety Lab checks passed; the page states no AI calls, no provider calls and no mutations.
- Trust Centre: tenant-scoped PostgreSQL, signed private sessions, human approval, server-side capture verification and audit log are configured. PayPal mock simulator signature is verified; real transaction webhook delivery and email inbox delivery remain unverified. Public demo mutations are disabled.
- Trust caveats are visible: real PayPal webhook delivery and email inbox delivery are not independently verified. Public shared-demo mutations are disabled; judges can inspect synthetic data without changing it.
- API smoke checks for health, invoices, recovery queue, summary, risk, Safety Lab, read-only simulation, Trust Centre, activity and proposals completed without errors. These were GET/read-only requests.
- GitHub Actions run `43165278581` passed: Node 22 syntax checks succeeded; the complete test suite reported 211 tests, 210 passed, 0 failed and 1 skipped. PostgreSQL integration run `43165285104` also passed, including the complete password-reset least-privilege migration and function tests.

## Password-reset least-privilege fix — prepared, not yet applied

- Read-only `pg_stat_activity` inspection confirmed the deployed Render app uses `paypilot_staging_runtime` and `paypilot_account_provisioner`; both are non-`BYPASSRLS` roles. The `paypilot_app` role is the Neon administration connection, not the observed Render runtime.
- The currently deployed password-reset SECURITY DEFINER functions are still owned by `paypilot_app`, so the reset path retains an unnecessarily broad function-owner boundary until the new migration is applied.
- New one-time migration: `db/migrations/20261112_password_reset_executor.sql`. It creates a `NOLOGIN`, non-superuser `paypilot_reset_executor` role with narrowly scoped `BYPASSRLS`, transfers only the reset tables/functions, limits its column grants, pins `search_path` to `pg_catalog, pg_temp`, denies direct table access with forced RLS, and grants function execution only to `paypilot_account_provisioner`.
- A fresh disposable Neon branch applied the exact migration successfully as `paypilot_app`. Post-migration checks confirmed: reset executor cannot log in, is not superuser, owns only reset objects, has no schema CREATE privilege; runtime/provisioner cannot read reset tokens; runtime cannot execute reset functions; provisioner can execute; token RLS is enabled and forced; the admin connection cannot inherit reset privileges and can SET ROLE explicitly for future maintenance.
- The migration also fixes the live schema mismatch: reset completion must update `password_updated_at`, not the stale `updated_at` name.
- The migration and reset flow are covered by the disposable PostgreSQL integration workflow. A separate disposable Neon branch confirmed the role/table/function ownership transfer and the reset-token creation path.
- The migration has **not** been applied to the live staging database. It is a one-time ownership transfer and must not be rerun after success. Apply it only after explicit confirmation of this exact staging change. The older `20261112_password_reset_least_privilege.sql` is marked superseded and intentionally performs no SQL.

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
| Staging deployment | Latest Render deployment live on commit `f7cb136`; build succeeded |
| Browser experience | Read-only shared-demo disclosure visible; Overview, Command Centre and Trust Centre navigated successfully |
| Safety Lab | 22/22 deterministic checks passed live |
| PostgreSQL and tenant isolation | CI integration passed tenant isolation, concurrent writes and cross-connection persistence |
| PayPal Sandbox capture | Current live staging snapshot shows zero verified captures and Acme Studio D-1001 remains open. A prior operator-reported test is not reflected in the current staging ledger; no new payment was initiated during this audit |
| PayPal webhook | PayPal mock simulator event reached the actual staging callback and its signature verified. Real buyer-approved transaction webhook remains unverified |
| Password-reset email | Brevo sender is active and the app reports configured; no test email has been sent and inbox delivery is not verified |
| Password-reset table least privilege | New restricted-owner migration is prepared and CI-tested; it has not yet been applied to live staging |
| New payment/reminder link origin | `APP_BASE_URL` set to staging; no new proposal was generated to avoid shared-demo mutation |
| Public judge mutations | Disabled on staging; the shared public tenant is read-only |
| Production | Separate production service was not accessed or modified |

## Submission checklist

1. Record the actual staging app on the intended device. Show the real app functioning; do not use fabricated screenshots or mock footage.
2. Keep the video under three minutes, upload it publicly to YouTube, and use only original or properly licensed audio/assets.
3. Add the public video URL, source repository, staging demo, project description and tools used to the Devpost submission.
4. The entrant must personally review the official rules, complete required fields and make any legal eligibility/originality attestations. Do not claim submission until Devpost confirms it.

Official deadline: 12 November 2026 at 12:00 PM Pacific Time (13 November 2026 at 01:30 AM India Standard Time).

## Safety boundaries during this audit

No production operation, payment, email send, password reset, demo seed/reset, invoice mutation or live database migration was performed. All live application checks were read-only; the only staging configuration change was setting the non-secret `APP_BASE_URL` to the staging origin.
