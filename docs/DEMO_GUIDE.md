# PayPilot AI — judge demo guide

**Hosted app:** https://paypilot-ai-1qw8.onrender.com/  
**Repository:** https://github.com/251fa04c84-boop/paypilot-ai

This guide is designed for a short, reproducible evaluation. The complete public demo is restricted and uses demo records only.

## Suggested 2-minute walkthrough

### 0:00–0:15 — Problem and product
Explain: small businesses lose time chasing unpaid invoices. PayPilot is an AI-assisted recovery agent that uses fixed rules, explicit human approval and PayPal Sandbox verification—not an unrestricted chatbot.

### 0:15–0:35 — Portfolio intelligence
Open Mission Control and run **Portfolio Autopilot Sweep**. Show that invoices are evaluated and proposed actions are queued for review rather than executed silently.

### 0:35–0:55 — Evidence-based decision
Open an overdue invoice. Point out verified facts, rule-based conclusions, the recommendation, risks/uncertainty and the separately labelled Gemini interpretation.

### 0:55–1:15 — Human approval and guardrails
Show the proposed action and approval requirement. Explain that the server revalidates the invoice before execution and only allowlisted actions are accepted.

### 1:15–1:40 — PayPal Sandbox payment
Create/approve a Sandbox checkout and complete it with a Sandbox buyer account. Show the server-verified capture and invoice status update. Never use a live buyer account or real money.

### 1:40–1:55 — Safety after payment
Reopen the paid invoice. Show that another reminder or checkout is blocked because the invoice is already paid.

### 1:55–2:00 — Audit
Open the invoice timeline or Activity tab to show recorded actions and payment evidence.

## Optional supporting scenarios

- **Dispute:** Harbor Dental demonstrates a human-review recommendation and blocked collection.
- **Prompt injection:** Injection Test demonstrates that hostile invoice notes are treated as untrusted data.
- **Outage:** demo outage switches show labelled fallback behaviour.
- **CSV:** Activity exports the audit log.

## Judge testing notes

- The Render free service may take up to a minute to wake.
- If demo records are missing, use **Load demo scenarios** in Mission Control.
- Sandbox checkout requires a PayPal Sandbox buyer account. Use only test credentials issued by PayPal Developer; do not enter a personal/live PayPal account.
- The demo has no login or tenant isolation. Do not enter real customer information.
- The application uses JSON-file storage on the free host; records can reset after a restart.
- Automated tests mock PayPal and Gemini. A successful CI run is not itself a live PayPal integration test.
- The maintainer reports a successful Sandbox payment and webhook end-to-end check on 4 November 2026. The automated webhook tests independently cover signature-verification logic using a mocked verifier.

## Video checklist

- Keep the YouTube video under 3 minutes.
- Show the real application running on the target device, not only slides.
- Include the end-to-end Sandbox payment and paid-invoice result.
- Show one agent decision and one safety guardrail.
- Use narration/captions in English.
- Use original narration and screen recording; avoid unlicensed music, logos or third-party copyrighted assets.
- Make the YouTube video publicly viewable and paste its URL into the Devpost submission.
