# PayPilot AI — impact case and measurement plan

## Intended user

Small service businesses, freelancers and boutique agencies that issue client invoices but do not have a dedicated accounts-receivable or collections team. The immediate user is the owner or operations person who reviews overdue invoices and decides whether to wait, contact the client, or request payment.

PayPilot is not a debt-collection service, credit-scoring product or accounting system. It is an operator-assistance workflow for prioritising and safely following up on invoices.

## Evidence that the problem is real

The following public surveys establish problem context. They are U.S.-specific and should not be generalized to every country or business type.

- Intuit QuickBooks' **2026 Small Business Late Payments Report** says 59% of surveyed businesses had invoices overdue by 30 or more days, and businesses with unpaid invoices were owed $17,700 on average. [Source: QuickBooks 2026 report](https://quickbooks.intuit.com/r/small-business-data/small-business-late-payments-report-2026/).
- Bluevine's February 2026 survey of 1,052 U.S. small-business owners found 29% had delayed their own pay because customers paid late, 17% had missed or nearly missed payroll, and 18% said time spent chasing payments was their biggest challenge. [Source: Bluevine Payment Gap survey](https://www.bluevine.com/newsroom/late-payment-gap-survey-press-release).

These sources support the importance of the problem; they do **not** prove that PayPilot improves payment speed, cash flow, or recovery rates.

## How PayPilot addresses the problem

| Operator problem | PayPilot mechanism | Evidence available in this demo |
|---|---|---|
| Too many invoices to review manually | Portfolio queue with a deterministic, explainable urgency heuristic | Live demo queue and score rationale |
| Generic chasing can damage client relationships | Wait after a recent reminder; keep disputed invoices out of active collection | Greenleaf wait recommendation; Harbor Dental dispute pause |
| Operators cannot tell whether an AI suggestion is safe | Facts, rules, uncertainty and optional AI commentary are separated | Invoice analysis and approval screens |
| An order can be mistaken for payment | Server verifies PayPal capture status, invoice reference, amount and currency | Safety Lab accepts exact capture fixtures and rejects pending/mismatched evidence; current live staging has zero verified captures |
| Decisions are hard to reconstruct | Approval, execution, verification and blocking events are logged | Invoice timeline and Activity export |

## What has been demonstrated — and what has not

**Demonstrated:**
- A portfolio of labelled demo invoices can be prioritised using deterministic rules.
- Disputed and already-paid invoices are protected from collection actions.
- A human must approve the exact proposed action.
- The deterministic Safety Lab exercises completed, pending, wrong-invoice, amount-mismatch, currency-mismatch, wrong-order-ID, multiple-purchase-unit, multiple-capture and missing-capture-ID cases.
- The current live staging snapshot shows Acme Studio D-1001 ($1,200 USD) still open and **zero PayPal-verified captures**. A previously reported Sandbox test is not reflected in the current staging ledger and is not presented as current live evidence.

**Not demonstrated:**
- A reduction in real businesses' days-sales-outstanding (DSO).
- A higher recovery rate or faster payment caused by PayPilot.
- Hours saved for a real operator.
- Live customer usage, customer satisfaction or willingness to pay.
- Production readiness or independent security certification. Tenant isolation and cross-connection persistence are covered by CI, but the live password-reset database-owner privilege issue remains unresolved.

Any Sandbox capture is test money, not revenue or a real customer recovery. Do not count a pending order, a historical test, or a Safety Lab fixture as a currently verified capture.

## Pilot measurement plan

Before making outcome claims, run a small opt-in pilot with real small businesses using only their authorized data and a secure, private deployment. Do not put real customer data into the current public shared demo.

Collect a baseline for at least two weeks, then compare with a four-week assisted-use period. Record sample size, invoice mix, payment terms and any other workflow changes.

| Metric | Measurement | Guardrail |
|---|---|---|
| Time to triage | Median operator minutes to identify next action for a batch of open invoices | Compare equivalent invoice volumes |
| Time to first follow-up | Median days from due date to first operator-approved follow-up | Do not count drafts as sent messages |
| Payment recovery | Share and value of invoices paid within 7/14/30 days after a follow-up | Count only payment-provider-confirmed receipts; separate manual confirmations |
| Dispute safety | Number of disputed invoices receiving automated collection proposals | Target zero |
| Operator effort | Minutes spent reviewing, editing and sending reminders per invoice | Self-reported time should be labelled as such |
| Verification integrity | Number of paid states supported by matching provider capture evidence | Target 100% of PayPal-marked paid records |

A small observational pilot cannot establish causality. Report counts, denominators, missing data and limitations; do not imply that PayPilot caused a payment merely because it happened after a reminder.

## Transparent value calculation

For a pilot, estimated operator time saved can be calculated as:

`(baseline median minutes per invoice - pilot median minutes per invoice) × invoices processed ÷ 60`

Multiply the resulting hours by the business's own fully loaded hourly cost only if that cost is supplied by the business. Do not assign a made-up hourly value.

Cash recovered must be reported separately and only when confirmed by the payment provider. Do not add unpaid invoice balances, pending orders, draft reminders or Sandbox test payments to real recovered cash.

## Next validation step

Recruit 5–10 small service businesses for structured interviews or a controlled pilot. Ask how they currently prioritise overdue invoices, how often they pause collection for disputes or recent contact, how long triage takes, and what evidence they need before trusting an automated recommendation. Publish anonymised findings only with participants' permission.
