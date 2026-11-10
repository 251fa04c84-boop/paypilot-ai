# PayPilot AI — final judge runbook and evidence checklist

## Demo safety
- Use the public judge preview and synthetic demo invoices only.
- PayPal is Sandbox only. Never enter a live PayPal account or real payment credentials.
- Do not enter real customer, financial, or personal data.
- A created order is not a payment. Only a server-verified completed capture may mark an invoice paid.
- The public preview is a shared demo tenant. Do not present it as private multi-tenant SaaS.

## Four-minute judge walkthrough

### 0:00–0:35 — Problem and portfolio
Explain that small service businesses need to decide which overdue invoices deserve attention. Open Mission Control and point out open invoices, overdue exposure, approvals waiting, and disputed invoices. Clarify that priority scores are explainable urgency heuristics, not payment predictions.

### 0:35–1:20 — Evidence-led agent
Open an overdue invoice. Show the recorded invoice facts, due date, reminder history, deterministic recommendation, uncertainty, and risks. Ask the assistant a portfolio question. Distinguish deterministic figures from optional Gemini commentary.

### 1:20–2:05 — Safety and human control
Open the disputed invoice scenario and show that collection actions are blocked. Open an eligible overdue invoice, request a proposal, and show the exact action, risks, expiry, and approval decision. Emphasize that AI cannot approve or execute the action.

### 2:05–3:15 — Payment boundary
Only if a fresh Sandbox checkout is known to work on the day: create the order, open the returned PayPal Sandbox approval page, sign in with a Sandbox buyer, approve, and return to PayPilot. Show the server-verified capture reference, exact amount/currency, and paid status. If checkout fails, stop and show the failure honestly; do not use simulated settlement as evidence of a real PayPal capture.

### 3:15–4:00 — Audit and limitations
Open Activity and show the timeline/export. State clearly that the app demonstrates a controlled workflow and Sandbox payment path, not improved recovery rates, production accounting compliance, or measured customer ROI.

## Evidence checklist

| Evidence | How to capture | Status |
|---|---|---|
| Public preview health | Save the JSON from `/api/health`; verify storage, AI, PayPal Sandbox and auth fields | Preview health checked 10 Nov 2026; see current operator evidence |
| Build/deploy | Record Render deploy ID, commit, status and completion time | Latest observed preview deploy: `0337acefabcf947da311e35db2eca8e00da08dda`, live |
| Automated tests | Save CI run URL and test summary for the exact release commit | PR #41 merge-ref CI passed 10 Nov 2026: 165 passed, 0 failed, 1 skipped; [Tests run](https://github.com/251fa04c84-boop/paypilot-ai/actions/runs/42779559048) |
| PayPal checkout | Capture order creation, Sandbox buyer approval, return, capture ID and verified invoice state | Retest required; user previously reported a pre-login Sandbox checkout error |
| Webhook | Save a real Sandbox webhook delivery and successful signature-verification evidence | Do not substitute mocked unit tests |
| Tenant isolation | Save real PostgreSQL cross-tenant read/write, session routing and restart/concurrency test results | PR #41 PostgreSQL integration job passed against disposable PostgreSQL 16: RLS tenant isolation, concurrent writes/persistence, and HTTP isolation/capture/webhook/restart integration passed; [PostgreSQL run](https://github.com/251fa04c84-boop/paypilot-ai/actions/runs/42779558831) |
| AI behaviour | Capture a factual answer, an unavailable-provider fallback and prompt-injection handling | Run against the exact deployed commit |
| Performance | Record cold-start and warm-request timings plus any Render errors | Not yet measured systematically |

## Release gates — do not claim complete until verified
1. Run `npm test` and CI on the exact candidate commit. PR #41 currently has passing merge-ref checks; rerun after any further commit and again on the final merge commit.
2. Run the real PostgreSQL integration suite against an isolated staging database and verify tenant A cannot read or mutate tenant B. PR #41 CI passed this against disposable PostgreSQL 16; repeat against the configured staging service before rollout.
3. Verify concurrent capture attempts result in one capture and duplicate webhook events do not double-settle.
4. Complete a fresh PayPal Sandbox buyer checkout from the deployed preview. Record the provider debug ID for any failure; never expose secrets or buyer data.
5. Verify the preview health endpoint, latest Render deployment, logs, and a cold/warm request sample.
6. Rehearse the walkthrough from a clean browser session and capture the evidence above.
7. Keep production unchanged until the candidate passes the release gates and a separate production rollout/rollback plan is approved.

## Claims to avoid
- Do not call Sandbox captures revenue or customer recoveries.
- Do not claim a higher recovery rate, lower DSO, or time saved without a measured pilot.
- Do not call the shared no-login judge demo a production multi-tenant service.
- Do not call mocked PayPal/Gemini tests live integration tests.
