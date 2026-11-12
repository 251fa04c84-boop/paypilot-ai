# PayPilot AI — Submission Readiness

Last verified: 12 November 2026 (read-only staging health and API inspection)

## Public staging demo

- URL: https://paypilot-ai-pg-staging.onrender.com/
- Environment: Render free-tier staging service, Singapore region
- Branch: `codex/paypilot-real-postgres-staging`
- Last confirmed deployed commit: `b0cb1f7c382da42422cfd6bc86c952343e90bac6` (Render deploy `dep-dbqglsoae00c738boue0`)
- Production remains separate and untouched: https://paypilot-ai-1qw8.onrender.com/

## What was verified on 12 November

- `GET /api/health` returned HTTP 200 and `ok: true`.
- Health reports PostgreSQL tenant-scoped storage, Gemini configured, PayPal Sandbox configured, signed-session auth enabled, and Brevo configured.
- Public judge-demo mutations are enabled for shared synthetic records. Public reset and demo-admin controls are disabled. Do not enter personal or confidential data.
- `GET /api/safety-lab` returned 18/18 deterministic checks on the deployed PR #52 build, with zero provider calls, zero model calls and zero mutations.
- `GET /api/intelligence/overview` returned seven open invoices, five risk-flagged invoices and three ledger consistency anomalies. The anomaly disclaimer correctly says these are not fraud determinations.
- `GET /api/trust` reports the Sandbox webhook ID and email provider configured. This reports configuration, not successful delivery.
- PR #52 CI passed: the Node 22 suite reported 196 tests, 195 passed, zero failed and one skipped; PostgreSQL integration passed tenant isolation, concurrent writes, cross-connection persistence and HTTP route checks.
- No payment, email send, reset, seed, invoice mutation or production operation was performed during this verification.

## Remaining external verification

1. **PayPal webhook delivery:** webhook ID is configured and signature/replay handling is covered by automated tests. Live delivery to this staging app is not independently verified; a previous read-only lookup found no matching event and zero listed events.
2. **Password-reset email:** Brevo is configured on staging. A prior reset request returned a generic accepted response, but that response intentionally does not disclose whether an account exists. Inbox delivery is not independently verified.
3. **Safety Lab:** PR #52 is merged and deployed. The live endpoint returned 18/18. These are deterministic policy regressions, not a penetration test or proof of live PayPal delivery.
4. **Judge interaction:** public judge-demo actions can change shared synthetic records. Public reset and demo-admin controls are disabled.

## Safe submission claims

PayPilot is an evidence-first receivables recovery demo using deterministic invoice rules, optional Gemini explanations, human approval gates, PayPal Sandbox payment verification, tenant-scoped PostgreSQL persistence, and an audit trail. The deployed Safety Lab exercises 18 deterministic policy, payment-evidence and approval-snapshot checks without provider calls or mutations. It is not a penetration test.

Do not claim real-money processing, proven recovery-rate improvements, independently verified live webhook delivery, or verified password-reset inbox delivery.

## Submission links

- Staging demo: https://paypilot-ai-pg-staging.onrender.com/
- Source repository: https://github.com/251fa04c84-boop/paypilot-ai
- Staging implementation PR: https://github.com/251fa04c84-boop/paypilot-ai/pull/28
- Evidence/trust/safety improvement PR: https://github.com/251fa04c84-boop/paypilot-ai/pull/50
