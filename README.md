# PayPilot AI: intelligent payment recovery assistant

Built for the **PayPal AI Hackathon 2026**. PayPilot AI helps a small business decide **which overdue invoice to chase first, why, what to say, and records exactly what happened**, then lets the client pay through the **PayPal Sandbox**.

```
Find the invoice that needs attention -> explain why -> recommend the next action
 -> AI drafts a personalised message -> YOU edit and approve -> record the outcome honestly
 -> client pays via PayPal Sandbox -> server verifies the capture -> invoice marked paid
```

> **Sandbox only.** The PayPal API address is hard-coded to `api-m.sandbox.paypal.com`, so this app cannot move real money.

## What is real, and what is not

| Feature | Status |
|---|---|
| Invoice create / edit / void / delete, correct due-date and overdue maths | Real, unit-tested |
| Recovery priority score and "why" explanation | Real and deterministic: computed from overdue days, amount and reminder history. **No randomness.** It ranks urgency; it does **not** predict whether a client will pay. |
| AI-written recovery messages | Real when `GEMINI_API_KEY` is set (Google Gemini via the Gemini API). Without a key, the app uses a template and **labels the draft "template"**. If an AI call fails, it falls back to the template and says so. |
| Human approval | Real. Drafts are editable; nothing is approved until you press Approve. |
| Sending the message | **Not automated.** PayPilot does not send email/SMS. After approval you copy the text, send it yourself, and press "I sent it". The audit trail says exactly this. |
| PayPal Sandbox payment | Real when Sandbox credentials are configured: server creates an order, buyer approves on PayPal, server captures and **verifies status, amount, currency and invoice** before marking paid. |
| Without PayPal credentials | The app still works; payment buttons are disabled and the header shows "PayPal Sandbox: not configured". Nothing is faked. |
| Storage | A JSON file (`data/db.json`). On Render's free plan the disk is not permanent, so data can reset after a restart or redeploy. |
| Demo data | Clearly labelled "(demo)" and "DEMO" and removable with one button. |

## Try it

### Option A: run locally (Node 20+)
```bash
git clone <this repo>
cd paypilot-ai
node server.js          # no npm install needed: zero dependencies
# open http://localhost:3000
```

### Option B: host free on Render (works from a phone)
1. Render dashboard -> **New -> Blueprint** (or Web Service) -> connect this repo. `render.yaml` sets it up on the free plan.
2. In **Environment**, add the variables below (type secrets directly into Render, never into the repo).
3. Open the Render URL.

### Environment variables
| Name | Needed for | Notes |
|---|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | PayPal Sandbox payments | From developer.paypal.com -> Apps & Credentials -> **Sandbox** tab |
| `GEMINI_API_KEY` | Real AI drafts | Free key from Google AI Studio. Free-tier prompts may be used by Google to improve its products, so use demo-level data. |
| `GEMINI_MODEL` | optional | Default `gemini-2.5-flash` |
| `APP_BASE_URL` | PayPal return links | Render sets `RENDER_EXTERNAL_URL` automatically |
| `SENDER_NAME` | optional | Signature on drafts |

### Demo walkthrough (for judges)
1. Open the app and press **Load demo data**.
2. Open the top-ranked invoice and tap **Why?** to see the scoring reasons.
3. Tap **Draft a message**, edit it, then **Approve message**. A PayPal Sandbox payment link is inserted.
4. Tap **Copy message**, then **I sent it**. See the honest entries in the **Audit trail**.
5. Tap **Pay with PayPal Sandbox**, log in with a Sandbox *personal* test account, approve. You return to the app, the server captures and verifies the payment, and the invoice becomes **Paid (PayPal Sandbox, verified)**.
6. Cancelling on PayPal leaves the invoice open and logs the cancellation.

## Tests

```bash
npm test      # or: node --test test/*.test.js
```
27 automated tests (Node's built-in runner, no dependencies), covering:
- date and overdue calculations, validation, deterministic scoring and ordering
- payment verification: matching capture, **amount/currency mismatch, wrong invoice, pending, unapproved order, duplicate payment**
- the HTTP API with a fake PayPal: success, **repeated/concurrent capture (PayPal called once)**, buyer cancel, unknown order ids, PayPal not configured, draft -> approve -> sent audit trail, AI success and AI failure fallback, static-file path traversal, security headers

**Not covered by automated tests:** the live PayPal Sandbox network calls (the tests use a fake PayPal) and the live Gemini call. The user interface was smoke-tested manually in headless Chromium at phone width, with no automated UI tests.

## Architecture

```
public/        mobile-first UI (vanilla JS, no framework, strict CSP, text built with textContent)
server.js      HTTP server + routes (zero dependencies)
lib/priority.js  dates, validation, explainable scoring, recovery queue (pure functions)
lib/payments.js  verifyCapture / applyCapture: the ONLY place an invoice becomes "paid" via PayPal
lib/paypal.js    PayPal Orders v2 client (sandbox only): token, create order, capture, get order
lib/ai.js        Gemini drafting + labelled template fallback
lib/store.js     JSON file storage + audit log helper
```

Key design decisions:
- **The server decides what is paid.** The browser never sees PayPal secrets or tokens. A click or a redirect cannot mark an invoice paid; only a verified PayPal capture can.
- **Only app-created orders can be captured.** The capture endpoint looks the order up in the server's own records first.
- **Idempotent capture.** Repeated requests do not capture twice; PayPal's "already captured" response is handled by re-reading the order.
- **Honest audit trail.** Entries describe only what really happened (for example, "You confirmed you sent reminder #1 yourself").

## AI usage disclosure

- **In the product:** Google Gemini (free tier) writes recovery message drafts when configured. A human must approve every message.
- **In development:** this project was written with assistance from Claude (Anthropic). All code was run through the tests above.

## Hackathon note: significant updates

This repository was created on **24 October 2026**, after the hackathon submission period began (1 October 2026). The whole codebase is new work for this hackathon.

## Known limitations
- No user accounts: anyone with the URL can see and edit the data. Use demo data only.
- JSON-file storage (not durable on Render free); no email/SMS sending; single currency per invoice; no refunds or webhooks (the app reads the capture result directly).
- Free-tier hosting sleeps when idle; the first request can take about a minute.

## License
MIT. See [LICENSE](LICENSE).
