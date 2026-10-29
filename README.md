# PayPilot AI: an agent for invoice recovery

Built for the **PayPal AI Hackathon 2026**. PayPilot AI is an AI agent for small-business payment operations. It does not just answer questions. It runs a bounded, auditable workflow on your invoices:

```
Observe -> Analyze -> Plan -> Ask for approval -> Execute (allowlisted action) -> Verify with PayPal -> Update records -> Audit
```

> **Sandbox only.** The PayPal API address is fixed to `api-m.sandbox.paypal.com`, so this app cannot move real money.
> **Restricted demo.** There are no user accounts. Use demo data only.

## Why this is more than a chatbot

| A chatbot | PayPilot AI |
|---|---|
| Answers "what should I do about this invoice?" | Reads the stored invoice, applies fixed rules, recommends one action and shows the evidence, risks and what is unknown |
| Cannot act | Proposes an action from a small **allowlist**, shows the exact action and waits for your explicit decision |
| Can say "done" | Never claims success itself. An invoice becomes paid only after the **PayPal capture is verified server-side** (status, amount, currency, invoice) |
| Leaves no trail | Records analysis, request, approval, attempt, service response, verification and state change |

## The agent loop, step by step

| Step | What happens | Where |
|---|---|---|
| Observe | Loads the invoice, payment evidence, reminder history, open PayPal orders | `lib/agent.js` `evaluate` |
| Analyze | **Verified facts** and **rule-based conclusions** are listed separately. Missing information is stated ("not recorded: whether the client replied"). An optional **AI interpretation** (Gemini) is labelled "commentary, not a fact" | `lib/agent.js`, `POST /api/invoices/:id/analyze` and `/interpret` |
| Plan | One recommendation with reason, evidence, risks, uncertainty and "this would change if..." | `evaluate().recommendation` |
| Request approval | A review card shows the invoice, amount, exact message or checkout, expected outcome, risks, expiry (30 minutes) and Approve / Reject | `POST /api/invoices/:id/proposals` |
| Execute | Only the approved action runs, after **revalidation** (invoice unchanged, still eligible, approval not expired) | `POST /api/proposals/:id/execute` |
| Verify | Reminders: released to you, **PayPilot does not send them**, and your records change only when you confirm. Checkout: the order is created, the buyer pays on PayPal, then the server captures and verifies | `lib/payments.js` |
| Update | Invoice state changes only after verification. Paid invoices close their unsent drafts and approvals | `applyCapture` |
| Audit | Every step is logged with timestamps and ids, and shown in the invoice timeline | `lib/store.js` `addAction` |

**Allowlisted actions:** `send_reminder` (release a draft for you to send) and `start_checkout` (create a Sandbox order). Nothing else can be proposed or run. An approval covers only its own action, on its own invoice.

## Safeguards (all covered by automated tests)

- Allowlist only. Unknown actions are refused (HTTP 400).
- Explicit approval, with reject, and **expiry** after 30 minutes.
- **Revalidation at execution:** a changed amount, a new dispute, a payment, or a void cancels the approval.
- **Idempotent and race-safe:** running an approved action twice or at the same time acts once.
- **Blocked actions are explained and logged:** already paid (with capture evidence), disputed, void, not due, reminder sent recently.
- **Prompt-injection defence:** invoice notes are untrusted data. The rules never read them. Instruction-like notes are flagged and withheld from the AI. Other notes are fenced as untrusted. AI text can never change status, rules or approvals.
- **AI output is untrusted:** length, no invented links, must match the invoice, cannot assert a payment status. Failures fall back to a labelled template. The label never says "AI" for template text.
- **Service outages:** Gemini tries a second model with backoff. PayPal failures keep the approval open and retryable, and never show a fake success.
- Rate limits on the API, AI calls and payment routes. Secrets live only in server environment variables.

## Demo scenarios (open the app, then Mission > "Demo mode")

1. **Portfolio Autopilot Sweep:** tap *Run Portfolio Autopilot Sweep* on Mission Control. The agent evaluates every invoice, determines recovery urgency, and prepares queued proposals in Approvals for your review.
2. **AI Recovery Assistant:** switch to the *AI Assistant* tab or use prompt pills to query receivables, overdue risk, and disputed accounts using deterministic tools.
3. **Overdue invoice:** open *Northwind Cafe*. Request approval for a reminder, approve, confirm you sent it. Then request a Sandbox checkout, approve, pay with a Sandbox buyer, and watch it become verified and paid.
4. **Disputed invoice:** open *Harbor Dental*. The agent recommends human review and blocks collection, with the reason logged.
5. **Already paid:** open *Lumen Books* (seeded as paid), or pay scenario 1 and try again. The attempt is blocked and the PayPal capture id is shown as evidence.
6. **Asynchronous Webhook:** tap *Simulate PayPal Webhook Payment* in Demo mode to verify server-to-server webhook processing without browser redirect.
7. **Service unavailable:** use the demo switches "Simulate AI outage" or "Simulate PayPal outage". Drafts fall back with a SIMULATED label, and a checkout stays approved and retryable. Simulations are clearly labelled and exist only in demo mode.
8. **Prompt injection:** open *Injection Test*. Its notes try to order the agent to mark the invoice paid. The agent safely treats it as data.
9. **Audit Log Export:** visit the *Activity* tab and tap *Export Audit Log (CSV)* for accounting compliance records.

## Verification status (honest)

| Claim | Status |
|---|---|
| PayPal Sandbox order, buyer approval, server-side capture and invoice marked paid | **VERIFIED** live on the deployed app (several real Sandbox payments, earlier versions) |
| Gemini writes invoice-specific drafts, labelled with the model | **VERIFIED** live (gemini-3.5-flash-lite) |
| Agent workflow (analyze, approve, run, verify, audit), blocking, expiry, revalidation, idempotency, outages, injection defence | **VERIFIED** (automated tests use a fake PayPal and fake Gemini) and walked through in a browser with mocks |
| Portfolio Autopilot Sweep and Batch Approval Decisions | **VERIFIED** via automated tests and live implementation |
| Conversational AI Recovery Assistant with deterministic tool calling | **VERIFIED** via automated tests and live implementation |
| PayPal Webhook listener & simulation | **VERIFIED** via automated tests and live implementation |
| Cancelled PayPal payment | **MOCK-TESTED** |
| Durable storage | **NOT IMPLEMENTED.** Data is a JSON file and resets when the free host restarts |
| Login and per-user data | **NOT IMPLEMENTED** (restricted demo) |
| Email or SMS delivery | **NOT IMPLEMENTED.** Messages are drafts you send yourself |

## Run it

```bash
node server.js          # Node 22, no npm install needed
# http://localhost:3000
npm test                # node --test test/*.test.js
```

Host free on Render (`render.yaml`). Environment variables (see `.env.example`):

| Name | Needed for |
|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | PayPal Sandbox (developer.paypal.com, Sandbox tab). Never commit them |
| `GEMINI_API_KEY` | Real AI. Free-tier prompts may be used by Google, so use demo data only |
| `GEMINI_MODEL` | Optional. Default `gemini-3.5-flash-lite`, then automatic fallback to `gemini-3.8-flash` |
| `APP_BASE_URL`, `SENDER_NAME` | Optional |

**For judges:** open the hosted demo (the free host can take up to a minute to wake), tap *Load demo scenarios*, and follow the scenarios above. To pay in the Sandbox use the test buyer login given in the submission.

## Tests

`npm test` runs 57 automated tests with Node's built-in runner: scoring and dates, payment verification (amount, currency, wrong invoice, pending, duplicate), portfolio autopilot sweeps, batch decisions, conversational assistant tool calling, webhook processing, audit exports, the agent workflow, approval, rejection and expiry, revalidation, idempotency and concurrency, disputed and paid blocking, prompt injection, AI failure, timeout and fallback, rate limiting, and security headers. **PayPal and Gemini are mocked in these tests.**

## Architecture

```
public/          mobile-first UI (vanilla JS, strict CSP, text built with textContent)
server.js        routes: invoices, agent (triage, proposals, batch-decision, assistant, dispute), PayPal, webhooks, demo
lib/agent.js     deterministic facts, rules, eligibility, allowlist, portfolio triage, assistant query processing, AI validation
lib/priority.js  dates, scoring and the recovery queue
lib/payments.js  verifyCapture and applyCapture: the only place an invoice becomes paid via PayPal
lib/paypal.js    PayPal Orders v2 client (Sandbox only)
lib/ai.js        Gemini calls with model fallback, timeout, backoff and validation
lib/store.js     JSON storage and the audit log
lib/summary.js   Multi-currency accounting totals
lib/ratelimit.js Sliding window rate limiters
```

## AI usage disclosure

Google Gemini writes optional drafts and interpretations at runtime. A human approves every action. Claude (Anthropic) was used as a coding assistant to write and test this code.

## Hackathon note

This repository was created on 24 October 2026, after the submission period began on 1 October 2026. All code is new work for this hackathon.

## Known limitations

No login (restricted demo). Storage is not durable on free hosting. Rate limits are in memory. No email or SMS sending. Sandbox payments only. One currency per invoice.

## License

MIT. See [LICENSE](LICENSE).
