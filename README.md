# PayPilot AI — an auditable agent for invoice recovery

**Live staging demo (PostgreSQL-backed):** https://paypilot-ai-pg-staging.onrender.com/  
**Separate original production service (not updated by this staging work):** https://paypilot-ai-1qw8.onrender.com/  
**Source:** https://github.com/251fa04c84-boop/paypilot-ai  
**Hackathon:** PayPal AI Hackathon 2026

PayPilot AI is an evidence-first receivables recovery agent for small businesses. It turns a scattered invoice list into a prioritised, explainable recovery plan: deterministic rules identify which accounts need attention, Gemini can translate the evidence into plain language, a human approves the exact next action, and PayPal Sandbox confirms whether money was actually captured. Every decision and outcome is traceable.

> **Sandbox only:** the PayPal API endpoint is fixed to PayPal Sandbox. This demo cannot move real money.  
> **Judge demo:** the public judge workflow remains a shared, no-login demo tenant unless private accounts are explicitly configured. Private account endpoints use scrypt password hashes, signed HttpOnly sessions and session-resolved tenant routing; they remain disabled unless `DATABASE_URL`, `JUDGE_DEMO_TENANT_ID`, `ACCOUNT_PROVISIONING_DATABASE_URL` and a strong `SESSION_SECRET` are configured and `/api/health` reports `auth.enabled: true`. Do not assume private accounts are enabled on a deployed service until that health field is verified. Production browser-facing mutations for the shared demo remain disabled by default. Use demo data only until a real customer deployment has been security-reviewed.  
> **Deployment distinction:** the staging demo is deployed from `codex/paypilot-real-postgres-staging` and reports PostgreSQL tenant-scoped storage. The original production service is separate and was not modified. The public staging preview has controlled judge-demo workflow actions enabled and uses shared synthetic records; those actions can change the shared demo data, and public reset is disabled. Private accounts use signed sessions and tenant-scoped PostgreSQL when enabled. This is a hackathon demo, not production accounting software.

### Public demo mutation switch

- Production defaults to read-only for browser-facing state changes because all visitors otherwise share one database.
- To enable the interactive judge walkthrough, explicitly set `ENABLE_PUBLIC_DEMO_MUTATIONS=true` in the hosting environment and restart/redeploy. This enables shared demo actions such as drafts, approvals, proposals and demo seeding; it does **not** enable invoice CRUD or demo-admin simulation controls.
- Keep it unset/false when the app is not being actively demonstrated. This is a temporary judge-demo control, not a substitute for authentication or tenant isolation.

## What makes PayPilot different

Most invoice tools stop at reminders, and most chat interfaces stop at suggestions. PayPilot connects the portfolio-level decision to a controlled, verifiable workflow:

- **Portfolio-first, not prompt-first:** one sweep evaluates every open invoice and stages a ranked set of proposals.
- **Explainable prioritisation:** the score is a transparent urgency heuristic built from days overdue, invoice amount, reminder history and due-soon timing. It is not a probability of payment or a credit score.
- **Evidence before language:** verified invoice facts and deterministic rules are kept separate from optional Gemini commentary.
- **Human authority at the point of action:** the operator reviews the exact proposed action; the server revalidates the invoice and approval before execution.
- **Money movement is not inferred:** a checkout is only an order. An invoice is marked paid only after server-side PayPal Sandbox capture verification or a verified signed webhook.
- **Safety is part of the workflow:** disputed and paid invoices are blocked; recent reminders can trigger a wait recommendation; untrusted invoice notes cannot instruct the agent.
- **Recovery outcomes are visible:** the currency-grouped outcome ledger separates PayPal Sandbox captures verified by the server from manual/demo paid records, and counts operator-confirmed reminders without pretending they are delivery receipts.

The product's core differentiator is the full chain from portfolio triage to evidence-backed approval to verified payment—not a claim that an LLM autonomously controls money.

## Judge evaluation map

| Judging area | What to inspect in PayPilot |
|---|---|
| Technological implementation | Portfolio triage, Gemini interpretation, bounded action allowlist, approval revalidation, PayPal Orders v2 Sandbox, capture checks, signed webhook verification, audit export |
| Design | Mission Control, currency-separated financial snapshot, priority queue, approval inbox, invoice evidence view, activity timeline |
| Potential impact | Small-business overdue receivables; prioritisation and operator time; dispute-aware collection; measured outcomes must come from real use, not demo estimates |
| Innovation / idea | Portfolio-level recovery orchestration with explicit authority boundaries and payment verification |
| Presentation | Run a portfolio sweep, inspect a disputed/overdue invoice, approve a recovery action, complete Sandbox payment, show verified result and audit trail |

## The problem and intended impact

PayPilot is designed for small service businesses, freelancers and boutique agencies that manage overdue client invoices without a dedicated receivables team. The workflow helps an operator decide which account needs attention, when to wait, when to pause a dispute, and whether payment was actually confirmed.

Recent U.S. research illustrates the problem: Intuit QuickBooks' 2026 report says 59% of surveyed businesses had invoices overdue by 30+ days and businesses with unpaid invoices were owed $17,700 on average ([QuickBooks](https://quickbooks.intuit.com/r/small-business-data/small-business-late-payments-report-2026/)). Bluevine's February 2026 survey of 1,052 U.S. small-business owners found 29% delayed their own pay because customers paid late and 17% missed or nearly missed payroll ([Bluevine](https://www.bluevine.com/newsroom/late-payment-gap-survey-press-release)). These are U.S. survey findings, not global estimates.

**Impact honesty:** these statistics establish the problem, not PayPilot's effectiveness. Our demo proves a controlled workflow and a PayPal Sandbox capture; it does not prove improved recovery rates, faster payment or hours saved. See [`docs/IMPACT_MODEL.md`](docs/IMPACT_MODEL.md) for the measurement plan and pilot metrics.

## Why this is an agent, not just a chatbot

A chatbot can suggest what to do. PayPilot evaluates invoice records, separates facts from conclusions, proposes a bounded action, waits for explicit human approval, revalidates the invoice, executes only an allowlisted operation, verifies payment with PayPal, updates the record, and logs the result.

```
Observe → Analyze → Plan → Request approval → Execute allowlisted action
       → Verify with PayPal → Update records → Audit
```

## Product workflow

| Stage | Behaviour |
|---|---|
| Observe | Reads invoice details, payment evidence, reminder history and open PayPal orders. |
| Analyze | Separates stored facts and deterministic rule conclusions from optional Gemini commentary. Missing information is called out. |
| Plan | Recommends an action with rationale, evidence, risks, uncertainty and conditions that would change the recommendation. |
| Request approval | Shows the exact proposed action and requires an explicit human decision. Approvals expire after 30 minutes. |
| Execute | Revalidates the invoice and approval; executes only the approved allowlisted action. |
| Verify | For checkout, the server captures and validates the PayPal response against the expected invoice, amount, currency and completed status. |
| Update | Marks an invoice paid only after successful server-side verification. |
| Audit | Records workflow actions and payment evidence in the invoice timeline and Activity export. |

**Allowlisted actions:** release a reminder draft for the operator to send, or create a PayPal Sandbox checkout. PayPilot does not send email/SMS reminders.

## AI and trust boundaries

- Google Gemini provides optional invoice-specific draft text and plain-language interpretations.
- Deterministic application rules—not the language model—decide invoice status, eligibility, approval state and whether an action may execute.
- AI output is treated as untrusted commentary: it is validated and cannot set payment status, bypass approvals or change rules.
- Invoice notes are untrusted input. Instruction-like content is flagged/withheld from the AI path; notes cannot override the agent's rules.
- If AI is unavailable or output fails validation, the application uses a clearly labelled fallback rather than pretending AI succeeded.

## PayPal integration and payment safety

- Uses PayPal Orders v2 in Sandbox only.
- The browser does not decide that an invoice is paid. The server verifies the capture status, amount, currency and invoice association before updating records.
- The real webhook endpoint verifies PayPal's webhook signature through PayPal's verification API, requires the configured Sandbox webhook ID, and handles duplicate event IDs to reduce replay/double-processing risk.
- The webhook route fails closed when required configuration or signature headers are missing or verification fails.
- Demo webhook simulation is isolated to demo invoices and is not a substitute for a real signed webhook.
- Never commit PayPal credentials, webhook IDs or Gemini API keys. Configure them as server environment variables.

### Verification status (distinguish manual checks from automated tests)

| Check | Evidence/status |
|---|---|
| Staging homepage and health endpoint | Browser inspection succeeded; homepage loaded without visible errors and `GET /api/health` returned HTTP 200 on 11 November 2026. |
| Gemini assistant read-only browser check | Live staging test returned invoice-specific overdue and dispute evidence and did not create proposals, approvals, payment links or execute actions. |
| Portfolio sweep browser check | One live sweep successfully staged a pending reminder-draft proposal for Greenleaf Co; no approval, execution or payment was performed. |
| PostgreSQL persistence and tenant isolation | GitHub Actions PostgreSQL integration workflow run `43035812286` completed successfully, including tenant isolation, concurrent writes, cross-connection persistence and HTTP route integration. |
| Private account/session flows | The same integration workflow passed private-account/session migrations and restricted lookup checks; live staging health reports authentication enabled. |
| PayPal Sandbox configuration | Live staging health reports PayPal Sandbox configured. A previous end-to-end Sandbox checkout was reported by the maintainer; no new payment was initiated during this staging verification. |
| PayPal webhook delivery | **Not currently verified for this staging app.** The latest read-only lookup using its Sandbox credentials returned 404 for the target event and zero listed events. Automated tests use a mocked verifier. |
| Password-reset email | **Not live on staging.** Brevo/Resend adapters and reset-token flow are implemented, but health reports `email.configured: false` because no provider API key and verified sender are configured. |

The manual Sandbox check is an operator-reported test, not a guarantee of production payment processing. Do not use this demo for real funds.

## Judge quick start

1. Open the [staging demo](https://paypilot-ai-pg-staging.onrender.com/). The free host may need up to a minute to wake.
2. Use **Load demo scenarios** in Mission Control if the demo data is not already loaded.
3. Follow the suggested walkthrough in [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md).
4. For checkout, use a PayPal Sandbox buyer account—not a personal/live PayPal account. Do not use real payment credentials.
5. Inspect the invoice timeline and Activity tab to see the audit trail.

The public demo is restricted and uses shared demo data. Judges should not enter personal, confidential or real customer information.

## Demo scenarios

1. **Portfolio Autopilot Sweep:** evaluate the invoice portfolio and queue proposals for human review.
2. **AI Recovery Assistant:** ask about receivables, overdue risk and disputed accounts; deterministic tools provide the underlying data.
3. **Overdue invoice:** request approval for a reminder draft, approve it, confirm that you sent it, then create a Sandbox checkout and complete a Sandbox buyer payment.
4. **Disputed invoice:** open Harbor Dental; the agent recommends human review and blocks collection.
5. **Already paid:** open Lumen Books or revisit a paid invoice; another reminder/checkout is blocked and payment evidence is shown.
6. **Webhook demonstration:** the demo-only simulated webhook path is available for demo invoices. Real webhook handling is a separate signed endpoint.
7. **Service unavailable:** use the demo outage switches to observe labelled fallbacks and retryable checkout behaviour.
8. **Prompt injection:** open Injection Test; malicious-looking invoice notes are treated as untrusted data.
9. **Audit export:** open Activity and export the audit log as CSV.

## Run locally

Requirements: Node.js 22.

```bash
node server.js
# Open http://localhost:3000
npm test
```

The project uses Node's built-in test runner. PayPal and Gemini are mocked in automated tests; running the test suite does not create real Sandbox transactions.

## Configuration

See [.env.example](.env.example). Configure values only in your local environment or hosting provider's secret/environment settings.

| Variable | Purpose |
|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | PayPal Sandbox REST API credentials |
| `PAYPAL_WEBHOOK_ID` | Sandbox webhook ID used for signature verification |
| `GEMINI_API_KEY` | Google Gemini API access |
| `GEMINI_MODEL` | Optional model selection |
| `BREVO_API_KEY` or `RESEND_API_KEY`, `EMAIL_FROM` | Optional password-reset email provider; sender address must be verified with the provider |
| `APP_BASE_URL`, `SENDER_NAME` | Optional application/reminder metadata |
| `PG_STORAGE_MODE=judge_demo`, `DATABASE_URL`, `JUDGE_DEMO_TENANT_ID` | PostgreSQL-backed judge demo; pre-provision the demo tenant |
| `ACCOUNT_PROVISIONING_DATABASE_URL` | Separate least-privilege connection for account + tenant creation and account lookup |
| `SESSION_SECRET` | At least 32 bytes of high-entropy secret used to sign seven-day sessions; generate with `openssl rand -base64 48` |

**Security:** do not paste secrets into GitHub issues, screenshots, public documentation or chat messages. Use demo data only. Free-tier AI provider terms may include use of prompts for service improvement; never submit personal or confidential data.

## Test coverage

`npm test` covers scoring and dates; payment verification (including amount, currency, invoice association, pending and duplicate cases); portfolio sweeps; batch decisions; assistant tool calling; webhook processing; audit exports; approvals, rejection, expiry, revalidation, idempotency and concurrency; disputed/paid blocking; prompt injection; AI failure, timeout and fallback; rate limiting; and security headers; structured untrusted-data prompt handling, 120-word AI draft limits, unsupported legal/penalty wording rejection, Gemini model failover and labelled fallback.

**Important test boundary:** PayPal and Gemini network calls are mocked in the automated suite. Live Sandbox checkout/webhook checks are separate manual integration tests.

## Architecture

```
public/          Mobile-first vanilla JavaScript UI; strict CSP
server.js        HTTP API: invoices, agent, approvals, PayPal, webhooks and demo routes
lib/agent.js     Deterministic facts/rules, allowlist, portfolio triage and assistant tools
lib/priority.js  Dates, scoring and recovery queue
lib/payments.js  Capture verification and paid-state transition
lib/paypal.js    PayPal Orders v2 and webhook verification client (Sandbox)
lib/ai.js        Gemini calls, fallback, timeout, backoff and output validation
lib/store.js     legacy local JSON store; lib/postgres-store.js request-scoped transactional tenant state; lib/postgres-repository.js account/session/reset/order persistence
lib/summary.js   Multi-currency accounting summaries
lib/ratelimit.js Sliding-window rate limiters
```

## AI usage disclosure

- **Google Gemini:** optional invoice-specific reminder drafts and plain-language interpretations at runtime. Deterministic rules remain authoritative.
- **Claude (Anthropic):** used as a coding assistant during implementation and testing.

## Hackathon development note

The public repository was created on 25 October 2026, during the PayPal AI Hackathon submission period. The project was developed and updated for this hackathon; the latest hardening work includes webhook signature verification, replay handling, demo-webhook isolation, CSV formula-injection protection and CI tests.

## Known limitations

- Public staging judge-demo actions are enabled and operate only on shared synthetic records; the public reset control is disabled. Private account flows are available when the configured database roles and session settings pass health checks.
- Password-reset email is not enabled on staging until a transactional email provider key and verified sender are configured.
- Rate-limit counters are in memory and are not distributed across instances.
- Reminder messages are drafts for the operator to send; the app does not send reminder email/SMS.
- PayPal Sandbox only; no real-money transactions.
- One currency per invoice.
- Automated tests mock external PayPal and Gemini network calls; a passing test suite does not prove live provider delivery.

## License

MIT. See [LICENSE](LICENSE).


### Reverse-proxy rate-limit identity

The application ignores `X-Forwarded-For` by default because clients can spoof it and bypass IP-based rate limits. Set `TRUST_PROXY=true` only when the deployment proxy is configured to overwrite/sanitize that header before forwarding requests. Do not enable it behind an untrusted proxy. When disabled, requests are grouped by the direct TCP peer address, which may cause shared limits behind a proxy; configure trusted proxy handling deliberately for the hosting environment.
