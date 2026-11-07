# PayPilot AI — an auditable agent for invoice recovery

**Live demo:** https://paypilot-ai-1qw8.onrender.com/  
**Source:** https://github.com/251fa04c84-boop/paypilot-ai  
**Hackathon:** PayPal AI Hackathon 2026

PayPilot AI helps small businesses decide what to do about unpaid invoices. It combines deterministic invoice rules, optional Gemini explanations, human approval, PayPal Sandbox checkout, server-side payment verification, and an audit trail.

> **Sandbox only:** the PayPal API endpoint is fixed to PayPal Sandbox. This demo cannot move real money.  
> **Restricted demo:** there is no login or tenant isolation. The public production deployment is read/demo-workflow only: creating, editing, deleting and manually settling invoice records are disabled. Use only the included demo data; do not enter real customer or financial information.  
> **Storage:** invoice and audit data use a local JSON file. On ephemeral/free hosting, data can reset when the service restarts. This is a hackathon demo, not a production accounting system.

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
| Sandbox checkout, buyer approval, server capture and invoice marked paid | Maintainer reports a successful end-to-end Sandbox payment on the deployed app; the UI showed the capture reference, server verification and paid invoice. |
| Real PayPal webhook delivery | Maintainer reports completing an end-to-end Sandbox webhook check on 4 November 2026. The repository's automated webhook tests still use a mocked PayPal signature-verification response; those tests do not independently prove live webhook delivery. |
| Webhook signature verification, missing configuration/headers, replay handling and retry behaviour | Automated tests with a mocked verifier. |
| Payment validation and agent safety rules | Automated tests with mocked PayPal/Gemini services. |
| Current CI | GitHub Actions test workflow passed on the latest main commit at the time this README was updated. |
| Durable database, authentication and tenant isolation | Not implemented. |

The manual Sandbox check is an operator-reported test, not a guarantee of production payment processing. Do not use this demo for real funds.

## Judge quick start

1. Open the [hosted demo](https://paypilot-ai-1qw8.onrender.com/). The free host may need up to a minute to wake.
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
| `APP_BASE_URL`, `SENDER_NAME` | Optional application/reminder metadata |

**Security:** do not paste secrets into GitHub issues, screenshots, public documentation or chat messages. Use demo data only. Free-tier AI provider terms may include use of prompts for service improvement; never submit personal or confidential data.

## Test coverage

`npm test` covers scoring and dates; payment verification (including amount, currency, invoice association, pending and duplicate cases); portfolio sweeps; batch decisions; assistant tool calling; webhook processing; audit exports; approvals, rejection, expiry, revalidation, idempotency and concurrency; disputed/paid blocking; prompt injection; AI failure, timeout and fallback; rate limiting; and security headers.

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
lib/store.js     JSON persistence and audit log
lib/summary.js   Multi-currency accounting summaries
lib/ratelimit.js Sliding-window rate limiters
```

## AI usage disclosure

- **Google Gemini:** optional invoice-specific reminder drafts and plain-language interpretations at runtime. Deterministic rules remain authoritative.
- **Claude (Anthropic):** used as a coding assistant during implementation and testing.

## Hackathon development note

The public repository was created on 25 October 2026, during the PayPal AI Hackathon submission period. The project was developed and updated for this hackathon; the latest hardening work includes webhook signature verification, replay handling, demo-webhook isolation, CSV formula-injection protection and CI tests.

## Known limitations

- No authentication, user accounts or tenant isolation; restricted shared demo only. The planned tenant-isolation architecture and release gates are documented in [docs/TENANT_ISOLATION_PLAN.md](docs/TENANT_ISOLATION_PLAN.md).
- No authentication, user accounts or tenant isolation; restricted demo only. Production blocks invoice creation, edits, deletion, dispute toggles and manual-paid actions; judges use the seeded scenarios and verified Sandbox checkout.
- JSON-file storage is not durable on ephemeral/free hosting and may reset after a restart.
- Rate-limit counters are in memory.
- No email/SMS delivery; reminder messages are drafts for the operator to send.
- PayPal Sandbox only; no real-money transactions.
- One currency per invoice.
- Automated tests mock PayPal and Gemini network calls.

## License

MIT. See [LICENSE](LICENSE).


### Reverse-proxy rate-limit identity

The application ignores `X-Forwarded-For` by default because clients can spoof it and bypass IP-based rate limits. Set `TRUST_PROXY=true` only when the deployment proxy is configured to overwrite/sanitize that header before forwarding requests. Do not enable it behind an untrusted proxy. When disabled, requests are grouped by the direct TCP peer address, which may cause shared limits behind a proxy; configure trusted proxy handling deliberately for the hosting environment.
