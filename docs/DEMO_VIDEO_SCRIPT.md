# PayPilot AI — Final Hackathon Demo Video Script

Target runtime: **2:40** (hard limit: under 3:00)
Format: single continuous screen recording with concise narration and readable captions.
Environment: public restricted demo, demo records only, PayPal Sandbox only.

## Recording safety

- Do not show API keys, environment settings, passwords, buyer credentials, personal email, or account identifiers.
- Never use a live PayPal account or real payment details.
- The public service has no login and uses ephemeral JSON-file storage. Do not enter real customer data.
- Do not claim that PayPilot sends email/SMS. It creates drafts for the operator.
- Do not say the AI determines whether an invoice is paid. Only verified PayPal evidence can do that.
- The previous D-1001 Sandbox capture was verified on 8 November, but the Render redeployment restarted the ephemeral store. D-1001 is open in the current demo dataset. Do not present the historical capture as currently visible or paid.
- If you decide to show a fresh Sandbox capture, use a separate demo invoice and a PayPal Sandbox buyer only. This creates a new test transaction. It is optional and should not be done with live funds.

## Shot-by-shot plan

| Time | Screen action | Narration |
|---|---|---|
| 0:00–0:18 | Start on Mission Control. Briefly show the Judge Quick Start card, then hold on the hero. | “Small businesses don't need another reminder chatbot. They need to know which unpaid invoice deserves attention, why, and what action is safe.” |
| 0:18–0:42 | Show financial snapshot grouped by currency and recovery priority queue. Expand “Why this score?” on one invoice. | “PayPilot is an evidence-first receivables recovery agent. It prioritises using overdue time, reminder history and due-soon timing. Every score is explainable; amounts are context, not a cross-currency scoring input.” |
| 0:42–1:05 | Open Harbor Dental D-1007. Point to dispute note and blocked actions. | “A disputed invoice is removed from automated collection and sent to human review. PayPilot does not keep chasing a customer when the underlying work is contested.” |
| 1:05–1:28 | Open Bright Labs or Northwind Cafe. Show dates, reminder history, score reasons, risks and unknowns. | “Every recommendation is tied to recorded facts. The score is a transparent urgency heuristic, not a prediction that someone will pay. Missing replies or promises remain unknown.” |
| 1:28–1:55 | Return to Mission and run Portfolio Autopilot Sweep. Open Approvals. Do not batch-approve. | “The agent evaluates the portfolio and stages proposed actions. It does not silently send messages or move money. The operator sees the exact action and must approve it.” |
| 1:55–2:18 | Open one reminder proposal. Show wording, expected outcome, risks and approval status. | “A reminder is a draft for the operator to review and send outside PayPilot. Before execution, the server revalidates the invoice snapshot so stale approvals cannot survive material edits.” |
| 2:18–2:38 | Show the PayPal Sandbox checkout path only if a fresh demo transaction has been deliberately completed; otherwise show the checkout proposal and explain the verification rule. | “For payment, PayPilot uses PayPal Sandbox. An order is not a payment. The invoice can become paid only after the server verifies the provider's completed capture against the invoice, amount and currency.” |
| 2:38–2:40 | Show Activity and close on Mission Control. | “Prioritise with evidence. Approve with control. Verify the money.” |

## Fresh Sandbox capture option

Only if you intentionally choose to create a new Sandbox test payment for the recording:

1. Use a separate demo invoice, not a real customer invoice.
2. Request the PayPal Sandbox checkout and approve the exact proposal in the app.
3. Complete the buyer approval using a PayPal Sandbox buyer account only.
4. Return to PayPilot and wait for the server-side verification result.
5. Show the capture ID, amount/currency match, paid state and audit entry.
6. If verification does not succeed, stop. Do not manually mark the invoice paid or simulate a webhook to make the video look successful.

## Phone recording workflow

1. Open the live app in Chrome on the Android phone and wait for it to finish loading.
2. Swipe down twice from the top of the screen and choose **Screen record**. Select device audio/microphone only if you are comfortable narrating live; otherwise record silently and add narration later.
3. Start recording before returning to the app. Keep the phone in portrait orientation and avoid showing notifications or personal account details.
4. Follow the shot list above. Do not create a new payment or approve an action unless you intentionally choose to demonstrate that exact Sandbox flow.
5. Stop recording, review the entire clip, and trim the start/end so the final video is under 3 minutes.
6. Upload to YouTube as **Public** or **Unlisted** only if the hackathon accepts unlisted links; verify the link in a signed-out browser before submitting.

## Final upload checklist

- [ ] Runtime below 3:00.
- [ ] Public YouTube URL; test the link in a signed-out/private browser.
- [ ] Live app visible, not a slide-only presentation.
- [ ] Judge Quick Start and at least one “Why this score?” explanation are shown.
- [ ] Narration accurately distinguishes deterministic rules, optional Gemini commentary and PayPal verification.
- [ ] No personal credentials, customer data or live payment information visible.
- [ ] No unsupported claims about production readiness, tenant isolation, recovery-rate improvement or real-money payments.
- [ ] Submission links point to the current GitHub repository and deployed app.
