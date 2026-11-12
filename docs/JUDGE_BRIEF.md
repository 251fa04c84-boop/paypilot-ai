# PayPilot AI — judge brief

## The 20-second pitch

Small businesses do not just need another invoice reminder. They need to know which unpaid account deserves attention, why, what should happen next, and whether a payment actually cleared.

**PayPilot is an evidence-first receivables recovery agent:** it ranks invoice urgency using transparent rules, explains the evidence with optional Gemini assistance, asks a human to approve the exact action, revalidates the invoice before execution, and records payment only after PayPal Sandbox confirms a completed capture.

## What to look at

| Judge question | Show this | What it proves |
|---|---|---|
| Is this a real agent workflow? | Mission Control → Portfolio Autopilot Sweep → Approvals | Portfolio-level observation, prioritised proposals and a human approval boundary |
| Is the reasoning grounded? | An overdue invoice → “Why this score?” / evidence and uncertainty | Recorded facts and deterministic rules are distinct from AI commentary and unknowns |
| Does it behave safely? | Harbor Dental dispute scenario and Injection Test | Disputed invoices are blocked; hostile invoice notes cannot change policy |
| Is PayPal central? | PayPal Sandbox checkout flow and payment evidence | An order is not treated as payment; server verification is required before settlement |
| Is the result auditable? | Invoice timeline and Activity export | Workflow actions and payment outcomes have a traceable record |

## Why this approach is different

PayPilot focuses on the recovery decision and its safety boundary, rather than trying to become a full accounting or reconciliation suite.

- **Portfolio-first:** ranks the work across open invoices instead of waiting for a chat prompt.
- **Evidence before language:** invoice facts, rule conclusions, risks and unknowns are shown separately.
- **Human authority:** no silent reminder delivery or autonomous money movement.
- **Provider-backed settlement:** only verified PayPal Sandbox capture evidence can change an invoice to paid.
- **Safety-aware:** disputes, already-paid invoices, recent reminders and stale approvals affect what can proceed.

## Technical trust model

- **Google Gemini:** optional reminder drafting and plain-language interpretation.
- **Deterministic application logic:** invoice status, prioritisation, eligibility, approvals and action allowlisting.
- **PayPal Orders v2 Sandbox:** checkout creation and server-side capture verification.
- **Signed webhook route:** signature verification and duplicate-event handling are implemented; automated tests mock the provider verifier.
- **Audit:** actions and payment evidence are recorded for inspection.

## Important limitations — state these honestly

- PayPal Sandbox only; no real funds move.
- No login or tenant isolation; the hosted demo is a shared, restricted judge workspace.
- JSON-file storage is ephemeral on free hosting and can reset after restart.
- Reminder messages are drafts; PayPilot does not send email or SMS.
- Gemini may be unavailable or rate-limited; deterministic analysis remains available.
- Automated tests mock PayPal and Gemini network calls. A passing test suite is not proof of a live provider transaction.
- The historical Sandbox capture described in the repository is not present in a reset live dataset. Do not show or describe it as currently paid.

## 90-second walkthrough

1. Mission Control: portfolio priority and currency-grouped exposure.
2. Open an overdue invoice: explain score, facts, evidence, risks and unknowns.
3. Open Harbor Dental: show dispute hold and blocked actions.
4. Run the portfolio sweep: inspect a proposal and explicit approval.
5. Finish with the PayPal verification rule and Activity audit trail.

## AI and code disclosure

- Runtime AI: Google Gemini for optional invoice-specific drafts and plain-language interpretations.
- Coding assistance: Claude (Anthropic).
- PayPal integration: PayPal Orders v2 Sandbox and signed webhook verification route.
- Repository license: MIT.
- Local run: Node.js 22, `node server.js`, then `npm test`.

**Closing line:** Prioritise with evidence. Approve with control. Verify the money.
