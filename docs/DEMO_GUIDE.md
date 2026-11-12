# PayPilot AI — judge demo guide

**Live PostgreSQL-backed staging demo:** https://paypilot-ai-pg-staging.onrender.com/  
**Source repository:** https://github.com/251fa04c84-boop/paypilot-ai  
**Staging implementation PR:** https://github.com/251fa04c84-boop/paypilot-ai/pull/28

The staging demo uses a PostgreSQL-backed shared synthetic judge tenant. Public judge workflow actions are enabled for the walkthrough and can change shared demo records; public reset and demo-admin controls are disabled. Do not enter personal, confidential or real customer data. The separate original production service was not modified.

## Under-three-minute judge narrative

The official PayPal AI Hackathon video limit is less than three minutes. Use [FINAL_DEMO_SCRIPT.md](FINAL_DEMO_SCRIPT.md) for the timed sequence. Staging now exposes the 18-check deterministic Safety Lab in Command Centre and at `/api/safety-lab`. The live endpoint returned 18/18 on 12 November 2026. These are policy regression checks, not a penetration test.

## Two-minute judge narrative

| Time | Show | Say |
|---|---|---|
| 0:00–0:15 | Mission Control overview | “Small businesses need to know which unpaid invoice deserves attention, why, and what action is safe. PayPilot turns receivables into a controlled recovery workflow.” |
| 0:15–0:35 | Currency-grouped exposure and recovery priority queue | “Every invoice is ranked using a published, deterministic urgency heuristic. Currency amounts are never compared without FX conversion, and the score is not a payment prediction.” |
| 0:35–0:55 | Open Harbor Dental / disputed invoice | “A disputed invoice is paused for human review. PayPilot blocks collection rather than pressuring a customer over contested work.” |
| 0:55–1:15 | Open an overdue invoice | “The analysis separates recorded facts, fixed rules, uncertainty and optional Gemini commentary. Gemini explains; it cannot decide eligibility or payment status.” |
| 1:15–1:40 | Run Portfolio Autopilot Sweep, then open Approvals | “The agent evaluates the portfolio and stages bounded proposals. A human reviews the exact action. The server revalidates the invoice before execution.” |
| 1:40–2:00 | Recovery metrics and Activity audit log | “The outcome ledger separates PayPal-verified Sandbox captures from manual records. Reminder counts mean the operator confirmed sending; they are not email-delivery receipts. Actions are traceable.” |

## Recommended walkthrough

1. Open the staging demo. Render's free tier may need time to wake.
2. If the portfolio is empty, use **Load demo scenarios**. Do not use reset; public reset is disabled.
3. Inspect the priority queue and open one overdue invoice. Expand **Why this score?** to see the deterministic evidence.
4. Open a disputed invoice and verify that reminder and checkout actions are blocked.
5. Open the invoice strategist and compare verified facts, rule conclusions, uncertainty, recommendation, and optional Gemini interpretation.
6. Open Command Centre and show the 18 deterministic Safety Lab checks. Confirm the live 18/18 result and explain that these are policy regression checks, not a penetration test.
7. Run **Portfolio Autopilot Sweep** only when ready to change shared synthetic data. Inspect the exact proposals in Approvals. Approval is required before an action executes.
8. Review the Recovery metrics card. **Paid via PayPal Sandbox** counts only records marked with a server-verified Sandbox capture. **Operator-confirmed reminders** counts the operator's recorded confirmation; it does not verify email delivery.
9. Open Activity and export the audit log if needed.

## What the outcome ledger means

- **PayPal Sandbox verified captures:** count and amount of invoice records whose payment method is PayPal Sandbox after server-side capture verification. Sandbox funds are test money, not revenue.
- **Operator-confirmed reminders:** count of reminders the operator explicitly confirmed sending. PayPilot does not send email or SMS and cannot independently verify delivery.
- **Manual/demo paid records:** shown separately from PayPal-verified captures. Never add them to verified PayPal recovery.
- **Outstanding, overdue, disputed and at-risk balances:** deterministic arithmetic, grouped by currency. Do not add USD and INR together.

## Safety and honest claims

- PayPal API calls are fixed to Sandbox. Never use a live PayPal account or real payment details.
- A PayPal order is not a payment. An invoice becomes paid only after the server verifies a completed capture against invoice ID, amount and currency, or processes a valid signed webhook.
- Human approval is required for the exact proposed action. Approvals expire and are revalidated before execution.
- Disputed and already-paid invoices are blocked from collection.
- Gemini provides optional explanation and draft wording; deterministic application rules remain authoritative.
- Automated tests mock external PayPal and Gemini calls. Passing tests do not prove live webhook delivery.
- Staging health returned HTTP 200 on 12 November 2026 and reports Brevo configured. A generic password-reset request was accepted, but inbox delivery is not independently verified. The Sandbox webhook ID is configured, but live webhook delivery to staging has not been independently verified.
- This is a hackathon demonstration, not production accounting software. Do not claim improved recovery rates, faster payments, hours saved, or real customer outcomes without a measured pilot.


## Payment reconciliation preview

1. Open **Reconcile** and paste a PayPal transaction CSV export.
2. Required columns: invoice number, amount and currency. Include transaction ID and provider status whenever available.
3. Run **Preview reconciliation**. The preview is read-only and never changes invoice or payment state.
4. A row becomes a review candidate only when the invoice number, amount and currency match exactly and a supplied provider status is completed/captured/successful.
5. Mismatches, missing status, pending payments, duplicate transaction IDs, disputed invoices, already-paid invoices, ambiguous invoice numbers and unmatched references are separately classified.
6. A candidate is not a verified payment and does not mark an invoice paid. Confirm payment through PayPal's server-side capture verification or a valid signed webhook.

The CSV parser limits input to 80 KB and 250 transaction rows. This feature is a reconciliation assistant, not a bank statement importer, provider API sync, or automated accounting adjustment. Never claim that a CSV row alone proves funds settled.

## Video checklist

- Keep the public YouTube video under 3 minutes.
- Show the live staging app and explain the small-business receivables problem in the first 15 seconds.
- Show one overdue recommendation and one blocked dispute.
- Show human approval and the distinction between a Sandbox order and a verified capture.
- Show the outcome ledger and explain its metric definitions.
- Show the audit trail.
- Narrate in English and make the video publicly viewable.
- Do not expose API keys, passwords, buyer credentials, personal account details or customer data.
