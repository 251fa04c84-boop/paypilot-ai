# PayPilot AI — final judge demo script

**Target runtime:** 2:45–2:55. The official PayPal AI Hackathon rules require a public YouTube video shorter than three minutes and footage showing the working application. Do not submit a static slide-only video.

## Timed sequence

| Time | Screen / action | Narration |
|---|---|---|
| 0:00–0:15 | Live staging Mission Control. Show the overview. | Late invoices create a daily decision problem: who needs attention, what action is safe, and did the money actually arrive? PayPilot turns receivables into a controlled recovery workflow for small businesses. |
| 0:15–0:35 | Portfolio queue and currency-separated summary. | PayPilot ranks open invoices using transparent signals such as days overdue, amount, reminder history and due-soon timing. The score prioritizes human review. It is not a credit score, payment prediction or fraud probability. |
| 0:35–0:55 | Open Risk Radar and a disputed invoice. | Risk Radar shows the evidence behind each flag. A disputed invoice is held for human review. PayPilot blocks collection instead of pressuring a customer over contested work. |
| 0:55–1:15 | Command Centre: payment anomalies and Safety Lab. | The Command Centre checks payment-ledger consistency and runs nine repeatable deterministic safety checks. They cover disputed and paid invoices, duplicate orders, stale orders, mismatches, contact pressure and prompt-injection isolation. These are policy regression checks, not a penetration-test claim. |
| 1:15–1:35 | Recovery simulator: select overdue invoice and preview reminder. Then select disputed invoice and preview checkout. | The recovery simulator previews the next step and explains blockers without creating an order, approval or proposal. A green result means eligible for human review, not approved or executed. |
| 1:35–1:55 | Assistant / evidence panel. | Gemini explains invoice-specific evidence and can draft a reminder. But the model cannot decide payment status or bypass application rules. A human approves the exact action; the server revalidates it. Approvals expire after thirty minutes. |
| 1:55–2:15 | PayPal Sandbox checkout flow. Use only an actual completed Sandbox checkout already verified by the operator. | A PayPal order is not a payment. The server verifies completed capture against invoice, amount and currency before marking it paid. This is Sandbox test money only. Do not imply a new transaction occurred unless the footage shows it. |
| 2:15–2:35 | Reconcile preview and Trust Centre. | Reconciliation is review-first. A CSV row never marks an invoice paid by itself. Trust Centre separates configured integrations from provider delivery that has not been independently verified. |
| 2:35–2:50 | Activity timeline and final product frame. | Every step leaves an audit trail. PayPilot is not an unrestricted chatbot with access to money. It is evidence-first recovery, human approval, verified Sandbox payment and accountable operations. PayPilot AI. Recover with evidence. Approve with confidence. |

## Recording and edit requirements

- Record the live staging application, not a mockup. Show the actual interface functioning on desktop or mobile.
- Use a landscape 16:9 recording at 1080p where possible.
- Use a clear, measured male English voice. Keep narration intelligible above music; duck the music under speech.
- Burn in accurate English captions, with no more than two lines at once.
- Use restrained chapter transitions and subtle UI sound effects only between sections. Avoid loud impacts, fast zooms and constant motion.
- Show the real Safety Lab output only after its endpoint and UI are deployed and verified.
- For the PayPal capture segment, show a previously completed and verified Sandbox capture or omit the segment. Never stage a fake paid result.
- Keep the final export under 2:55, upload publicly to YouTube, and verify playback and captions before submitting.
- Do not show secrets, credentials, buyer account details, or private customer data.
