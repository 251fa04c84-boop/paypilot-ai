# PayPilot AI — judge demo guide

**Hosted app:** https://paypilot-ai-1qw8.onrender.com/  
**Repository:** https://github.com/251fa04c84-boop/paypilot-ai

This guide describes the currently deployed restricted demo. Use demo records only. The public app has no login or tenant isolation; all visitors share one demo workspace, and the Render free-tier JSON store can reset after a restart.

**Release verification note (8 Nov 2026):** The currently live Render deployment is still commit `0072714`. The Judge Quick Start card and invoice-card “Why this score?” disclosure have been merged into GitHub `main` (commit `366213a`) but have **not** yet been confirmed on the hosted site. Until Render reports that commit as live, judges will see the earlier collapsed “Demo mode: scenarios for judges” section and the existing score meter/detail evidence. Do not narrate the new card as visible until the deployment is verified.

## 2-minute judge narrative

| Time | Show | Say |
|---|---|---|
| 0:00–0:15 | Mission Control and Judge Quick Start | “Small businesses need to know which unpaid invoice deserves attention, why, and what action is safe. PayPilot turns receivables into a controlled recovery workflow.” |
| 0:15–0:35 | Currency-grouped financial snapshot and recovery priority queue | “The portfolio is prioritised with a transparent urgency heuristic. Amounts are context, not a cross-currency scoring input.” |
| 0:35–0:55 | Open Harbor Dental D-1007 | “A disputed invoice is paused for human review. The agent blocks collection actions rather than pressuring a customer over contested work.” |
| 0:55–1:15 | Open an overdue invoice such as Northwind Cafe or Bright Labs | “The analysis separates recorded facts, deterministic rules, uncertainty and optional Gemini commentary. Gemini explains; it cannot decide eligibility or payment status.” |
| 1:15–1:40 | Run Portfolio Autopilot Sweep only if the shared demo is ready; then open Approvals | “The agent stages bounded proposals. A human reviews the exact action. The server revalidates the invoice before execution.” |
| 1:40–2:00 | AI Assistant quick prompts and Activity export | “The assistant answers from verified application facts, and actions that really occur are recorded in the audit trail. An empty activity feed means no workflow action has yet occurred in this demo session.” |

## Recommended judge walkthrough

1. **Read the portfolio:** review open/overdue counts, paused disputes and currency-grouped exposure.
2. **Inspect a decision:** open Northwind Cafe or Bright Labs and inspect verified facts, rule conclusions, recommendation, evidence, risks and unknowns.
3. **Challenge safety:** open Harbor Dental D-1007 and confirm that dispute status blocks collection actions. Open Injection Test D-1008 to inspect hostile notes being treated as untrusted data.
4. **Try the assistant:** use “Who should I chase today?” or “Show disputed invoices.” Treat Gemini as optional explanation; deterministic rules remain authoritative.
5. **Optionally test approvals:** run Portfolio Autopilot Sweep, inspect the generated proposal and approve only a test reminder if you intend to change shared demo state. PayPilot creates a draft for the operator; it does not send email or SMS.
6. **Test payment only if deliberately needed:** a PayPal Sandbox order is not a payment. Only a completed provider capture verified server-side against invoice ID, amount and currency can mark an invoice paid. Use a PayPal Sandbox buyer account only.

The visible **Judge Quick Start** card on Mission Control points to the dispute, assistant and approval areas. The more detailed scenario controls remain under “Demo mode: scenarios for judges”.

## PayPal Sandbox evidence — important distinction

A buyer-approved PayPal Sandbox checkout and server-side capture verification were successfully completed for Acme Studio D-1001 ($1,200 USD) on 8 November 2026. This was test money, not a real customer payment.

**That historical capture is not present in the current live demo state.** A Render redeployment restarted the ephemeral JSON store; D-1001 is open again in the current demo dataset. The current portfolio snapshot therefore shows no PayPal-verified paid amount. Do not describe D-1001 as currently paid or show the historical capture as if it were visible in the live app. Do not create another payment merely to recreate a screenshot.

A live PayPal webhook delivery was not independently proven in the latest verification pass. Automated webhook tests use a mocked PayPal signature verifier; describe this accurately.

## Demo safety and limitations

- PayPal API calls are fixed to Sandbox; never use a live PayPal account or real payment details.
- The app has no login or tenant isolation. All visitors share the same demo data. Never enter real customer or financial information.
- The public demo may allow shared workflow mutations while the judge walkthrough is enabled. These actions affect the shared workspace.
- Invoice create/edit/delete and manual settlement are disabled in production.
- Reminder messages are drafts; PayPilot does not send email or SMS.
- Gemini may time out or be rate-limited. The app should show a labelled fallback; deterministic analysis remains available.
- Render's free-tier JSON file is ephemeral and may reset after restart.
- Automated tests mock external PayPal and Gemini network calls. A passing CI run is not proof of a live provider transaction or webhook delivery.
- Do not claim production readiness, tenant isolation, durable storage, improved recovery rates, or hours saved without pilot evidence.

## Video checklist

- Keep the public YouTube video under 3 minutes.
- Show the live app and explain the portfolio-level problem in the first 15 seconds.
- Show one overdue recommendation and one blocked dispute scenario.
- Show the human approval boundary and explain that reminders are drafts.
- Show a completed Sandbox capture only if it is actually visible in the recording session; otherwise explain the server verification rule without implying a current paid record.
- Narrate in English and make the video publicly viewable.
- Do not expose API keys, passwords, buyer credentials, personal account details or customer data.
- Link the public repository and hosted demo; do not overstate impact or production readiness.
