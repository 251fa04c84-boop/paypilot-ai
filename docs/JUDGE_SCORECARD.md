# PayPilot AI — judge scorecard and winning strategy

This is an internal product strategy document, not a claim of judge scores or a guarantee of placement.

## Competition rubric

The PayPal AI Hackathon lists five equally weighted criteria. Stage one is a pass/fail viability check: the project must fit the theme and meaningfully use PayPal. The five scored categories are technological implementation, design, potential impact, innovation/idea, and presentation.

| Category | Judge's likely question | PayPilot evidence | Remaining work |
|---|---|---|---|
| Technological implementation | Is PayPal central, is AI meaningful, and is the implementation non-trivial? | PayPal Orders v2 Sandbox, server-side capture verification, signed webhook verification, optional Gemini interpretation, deterministic agent tools, approval revalidation, tenant-scoped PostgreSQL, audit events, 22-check Safety Lab | Keep live deployment aligned with tested staging source; verify live provider delivery separately; resolve the remaining password-reset database-owner privilege issue before production use |
| Design | Does this feel like a complete product? | Mission Control, financial snapshot grouped by currency, recovery queue, approval inbox, invoice evidence view, assistant, activity export | Verify refreshed layout in real mobile and desktop browsers; test empty/error/loading states and keyboard access; refine detail and approvals screens |
| Potential impact | Is the user and problem specific, and is the benefit credible? | Small businesses managing overdue invoices; portfolio triage, dispute pause, reduced manual prioritisation and auditable workflow | Validate with real small-business operators if possible; measure time-to-prioritise and recovery outcomes; do not turn demo data into impact claims |
| Innovation / idea | Why is this different from existing invoice reminders or chatbots? | Portfolio-level recovery plan with evidence, human authority, bounded actions and PayPal-verified settlement | Make the difference obvious in first 20 seconds; show disputed and already-paid safety paths; avoid claims of autonomous money control |
| Presentation | Can judges understand and see it work end-to-end? | Hosted staging app, visible shared-demo disclosure, judge guide, overdue/dispute/injection scenarios, live 22/22 Safety Lab and audit trail | Record a public YouTube video under 3 minutes. The current live ledger has zero PayPal-verified captures; show the Safety Lab's payment-evidence checks instead of implying a completed payment |

## Positioning

**One-line product claim:** PayPilot is an evidence-first receivables recovery agent that prioritises unpaid invoices, proposes bounded actions for human approval, and verifies PayPal Sandbox payment before recording settlement.

**Core differentiation:** the complete chain from portfolio triage → evidence-backed plan → explicit approval → allowlisted execution → PayPal verification → audit.

Do not claim:
- that the urgency score predicts payment probability;
- that Gemini makes payment or eligibility decisions;
- that PayPilot sends email or SMS;
- that simulated webhook events are real PayPal webhooks;
- that the public shared judge demo is isolated per visitor or that the application is production-ready; private signed-session workspaces and tenant-scoped PostgreSQL exist, but a live password-reset database-owner privilege issue remains unresolved;
- that a Sandbox payment moves real money;
- that demo data proves customer impact.

## Sponsor prize decision

- AG Grid has the most attractive listed cash sponsor prize, but the project should only enter that category if AG Grid is genuinely integrated into a useful workflow (for example, a sortable/filterable receivables workbench with grouped currency and action status) and the actual AG Grid tool requirement is satisfied. Do not add a logo or unused dependency to claim eligibility.
- APIMatic, Bryntum and Channel3 should be considered only if their tools materially improve PayPilot. Their integration must be real, disclosed and reproducible.
- Render sponsor awards are credits, not cash; they should not distract from the grand prize or cash honorable mentions.

## Release gates

1. Keep changes isolated on reviewable branches until the relevant tests pass.
2. Require the complete Node 22 test workflow to pass before merging.
3. Render staging is configured for `codex/paypilot-real-postgres-staging`; the separate original production service remains untouched. Verify the exact staging commit is deployed and healthy before claiming the live demo contains a change.
4. Check the live hosted app separately; a green test suite does not prove a live Sandbox transaction or live webhook delivery.
5. The final submission must link the public repo, hosted demo, tool disclosure, complete description and public YouTube video under three minutes.
6. The demo must use test records and PayPal Sandbox credentials only.

## Current competitor benchmark (public Devpost pages checked 8 Nov 2026)

These are competitor-published descriptions, not independent security or product audits. Features and test counts below are claims on their project pages unless explicitly identified as an independently verified observation.

| Project | Competitive strengths described publicly | Stated limitations / evidence boundary | Implication for PayPilot |
|---|---|---|---|
| [Unstuck](https://devpost.com/software/unstuck-ipxchy) | Closest direct receivables-recovery concept; cause-specific diagnosis from client words, owner policy checks, client-facing payment plans, AG Studio insights, six-stage resolution loop | Its page explicitly labels demo actions and client payments as simulations, says PayPal was not called, and says sandbox writes/webhooks are not yet verified live | Stronger cause-of-delay narrative and AG Studio presentation. PayPilot must lead with real verified Sandbox settlement, dispute-aware controls and strict evidence/unknown separation |
| [Kioku × PayPal](https://devpost.com/software/kioku-x-paypal) | Broad owner-approved agent workflow for creating/sending invoices, reminders, recording non-PayPal payments, reading PayPal as source of truth, checking model claims against provider state; AG Grid; page claims 248 tests | Project page says setup requires the judge's own Sandbox keys and describes a local setup rather than a hosted judge demo; no independent audit performed | Stronger breadth and agent memory narrative. PayPilot should not imitate everything; show a tighter, more auditable recovery-to-capture loop with a hosted zero-setup experience |
| [SettleSight](https://devpost.com/software/settlesight-5vwzu0) | Reconciliation cockpit, PayPal Invoicing v2 + Transaction Search, fee/partial/combined/refund/duplicate heuristics, AG Studio and custom widgets; page describes a $25 Sandbox partial-payment write-back and 80 tests | Page explicitly says synthetic demo data and Sandbox records; its listed next steps include real-time webhooks | Stronger reconciliation depth and sponsor-tool use. PayPilot should emphasise recovery operations rather than compete as a bookkeeping/reconciliation suite |
| [ReconPilot](https://devpost.com/software/reconpilot) | Natural-language AI filters over PayPal Sandbox transactions, deterministic duplicate/fee/refund checks, draft recovery invoices, flagged-row export; AG Grid + Gemini function calling | Page says its grid combines real Sandbox transactions with a generated demo ledger of about 250 planted-error rows; direct refund handling and webhooks are listed as future work | Stronger AI-driven table interaction and transaction anomaly coverage. PayPilot's advantage is approval-bound workflow and verified capture safeguards |
| [Cross-Border Reconciliation Agent](https://devpost.com/software/paypal-reconciliation-agent) | Public page describes multi-API reconciliation and Sandbox ledger workflows | Claims not independently checked in this review; focus is reconciliation, not the same receivables-recovery problem | Adjacent competitor, not the closest product match |
| [CartSplit AI](https://devpost.com/software/cartsplit-ai-paypal-ai-hackathon-2026-demo) | Agentic group payments and shopping with sponsor integrations such as Channel3/APIMatic | Different customer problem; not a direct invoice-recovery substitute | Raises the overall bar for clear agentic workflows and meaningful sponsor-tool integration |

### PayPilot's defensible position

PayPilot should not claim that no competitor has a real Sandbox integration. SettleSight and Kioku also describe Sandbox operations. Its defensible proof is narrower and specific:

1. The application implements server-side PayPal Sandbox capture verification bound to the stored order, invoice, amount and currency. A prior operator-reported $1,200 Sandbox test is not present in the current staging ledger; the live snapshot shows Acme Studio D-1001 still open and zero verified captures. Do not present the historical test as current live evidence.
2. Dispute-aware blocking, including protection against capture after dispute status changes.
3. Approval snapshot revalidation: material invoice edits cancel stale proposals before execution.
4. Currency-neutral urgency ranking and currency-grouped exposure.
5. A small, hosted, no-login judge experience that makes the core workflow accessible without asking judges to configure Sandbox credentials.

### Competitive gaps to address

- Make the first 20 seconds explain why PayPilot is not a generic reminder chatbot.
- Show one source-backed reason and clearly label missing client responses/payment promises as unknown; never invent a root cause.
- Make the dispute hold and stale-approval behavior visible, not buried in documentation.
- Explain that Gemini drafts/explains only; deterministic policy governs eligibility and PayPal governs verified payment status.
- Complete the public demo video. A strong product without a public video risks losing presentation points.
- Do not bolt on AG Grid/AG Studio or another sponsor tool solely for a logo. Only pursue a sponsor award if a useful integration can be built, tested and shown honestly before submission.


## Demo story

1. Start in Overview and explain the portfolio-level problem and currency-separated exposure.
2. Open Risk Radar and inspect the disputed invoice; show the explicit hold.
3. Open an overdue invoice and separate facts, fixed rules, uncertainty and optional AI commentary.
4. In Command Centre, show the anomaly monitor and all 22 passing Safety Lab checks.
5. Use the read-only recovery simulator to preview a reminder/checkout and explain that it does not create records or call PayPal.
6. Show the approval expiry/revalidation boundary and audit history. A fresh portfolio sweep is optional and changes shared demo state.
7. Close with the differentiator: prioritise with evidence, approve with control, and verify payment only with matching provider evidence. The current live snapshot has zero verified captures.


## Broader market benchmark — 9 November 2026

This comparison uses public product material and a recent comparative review. Vendor feature claims are not independent proof of outcomes. PayPilot is a hackathon prototype with a public shared demo; the commercial products below are established products with substantially broader integration and operating scope.

### Category-by-category comparison

| Category | Market benchmark | PayPilot today | Gap / practical decision |
|---|---|---|---|
| Invoice prioritisation | Upflow, Tesorio and enterprise AR tools combine portfolio context, workflow and risk views | Explainable deterministic urgency score; currency-neutral; portfolio queue | **Competitive core.** Keep the score explainable; add promise/dispute context only when recorded and traceable |
| AI collections communication | Upflow/Tesorio offer configurable agent actions; Chaser focuses on drafts and human approval | Gemini explains verified facts and drafts reminders; user sends externally | **Gap.** No inbox/email/SMS integration or reply ingestion. Do not claim autonomous collections |
| Promise-to-pay tracking | Leading AR workflows identify payment promises and escalate missed commitments | No structured promise date/status; analysis explicitly says reply/promise is unknown | **High-value gap.** Add a human-recorded promise-to-pay field and missed-promise queue before attempting mailbox automation |
| Dispute management | Commercial suites track disputes and resolution workflows | Disputed flag and note pause collection; audit events | **Partial.** Add structured reason, owner, next-review date and resolution note; preserve human control |
| Payment acceptance | Competitors often provide customer payment portals and multiple payment rails | PayPal Sandbox checkout only | **Major breadth gap.** Keep PayPal as the verified rail for this prototype; design an adapter boundary before adding Stripe/ACH/UPI. Do not pretend multi-rail support exists |
| Cash application / reconciliation | Upflow, Tesorio, Kolleno and Gaviti automate matching of incoming cash to invoices, including remittance exceptions | Verifies one PayPal order capture against invoice reference, amount and currency | **Major gap.** No bank-feed/remittance ingestion, partial payment, fee allocation or multi-invoice matching. Defer broad reconciliation until there is a safe source of real transaction data |
| Cash forecasting | Tesorio and Kolleno market AR-based cash forecasts | Currency-grouped outstanding/overdue arithmetic; no arrival forecast | **Gap.** Add transparent scenario totals only if they are deterministic and label assumptions; do not invent payment probabilities |
| Accounting / ERP / CRM integrations | Upflow, Tesorio and Kolleno advertise multiple ERP, accounting, CRM, email and bank connections | PayPal Sandbox and internal demo records; no verified QuickBooks/Xero/NetSuite sync | **Major gap.** Build one useful integration end-to-end rather than a fake connector gallery. Prioritise CSV import/export first, then a real accounting integration |
| Customer self-service | Commercial tools offer customer payment portals and invoice status/history | No authenticated customer portal; hosted demo is intentionally no-login and shared | **Gap.** Do not add customer login until request-scoped tenancy and access controls are complete |
| Agent governance | Upflow documents per-skill allow/approval/block controls and recorded agent runs; Tesorio markets controls and governance | Allowlisted actions, human approval, snapshot revalidation, dispute blocks, audit trail | **Strong differentiator.** Expand from global fixed policy to explicit per-action policy only after secure identity/tenant boundaries exist |
| Payment security | PayPal requires server-side OAuth, HTTPS, secret protection and webhook signature verification | Server-side credentials, Sandbox-only integration, capture validation and signature-verification path | **Good foundation.** Still need deployed negative tests, durable event idempotency and tenant-bound order routing before production |
| Reliability / operations | Mature platforms need retries, observability, incident response, backups and reconciliation | Node test suite, health endpoint, bounded API rate limits; Render free service may sleep | **Partial.** Add request IDs/structured redacted logs, backup/restore drill, alerting and persistent webhook state |
| Data isolation / identity | Commercial systems require tenant-scoped users, roles and auditability | Public judge demo is shared synthetic data; private workspaces use signed HttpOnly sessions and tenant-resolved PostgreSQL; CI covers tenant isolation and cross-connection persistence | **Improved but not production-ready.** The live password-reset tables/functions are owned by a BYPASSRLS database-owner role; the proposed least-privilege migration is not safe for that role and remains unapplied |
| UX / accessibility | Commercial tools offer role-based work queues, customer context and reporting | Mobile-first Mission Control, invoice detail, approvals, assistant, activity export | **Promising prototype.** Add clear empty/error states, keyboard/screen-reader checks and a first-run guide |
| Analytics / ROI proof | Mature tools show DSO, collection effectiveness, cash application rates and operational savings | Basic portfolio arithmetic; no real customer cohort or outcome evidence | **Gap.** Instrument triage time, approved follow-up, verified recovery and dispute safety; report only measured pilot results |
| Pricing / target segment | Many established products target mid-market/enterprise and may require demos or quote-based plans | No paid plan or customer validation | **Opportunity, not a feature gap.** Stay focused on freelancers and small service businesses; test willingness to pay before building enterprise complexity |

### Direct hackathon-project comparison

The earlier Devpost comparison remains relevant: Unstuck is close to the recovery workflow; Kioku has broader owner-approved invoice/payment actions and an AG Grid experience; SettleSight and ReconPilot lean more heavily into reconciliation and transaction analysis. Their public descriptions are competitor claims, not independent security audits. PayPilot should not copy their breadth at the expense of its strongest evidence-backed workflow.

### Competitive scorecard (qualitative, not a judge score)

| Dimension | PayPilot position | Evidence / confidence |
|---|---|---|
| Recovery-specific workflow | Strong | Implemented triage, proposal, approval, execution and audit path |
| AI usefulness | Moderate | Gemini interpretation is configured; fresh live response must be separately verified |
| Human control / explainability | Strong | Deterministic eligibility, allowlisted actions, approval snapshot and dispute blocks |
| Payment proof | Strong implementation safeguards, limited current live evidence | Server-side capture validation and 22 deterministic evidence tests; current live ledger shows zero verified captures and a stale open order |
| Integration breadth | Weak | PayPal Sandbox only; no verified accounting/CRM/bank connectors |
| Cash application / forecasting | Weak | No remittance matching or predictive forecast |
| Dispute and promise workflows | Partial | Dispute pause exists; promise-to-pay and structured case resolution do not |
| Security / tenancy | Stronger foundations; unresolved database-owner issue | Private signed sessions, tenant-resolved PostgreSQL and CI isolation tests; public judge tenant remains shared synthetic data; password-reset owner/BYPASSRLS boundary unresolved |
| Reliability / observability | Moderate prototype | CI and health check exist; production-grade alerting/restore/queue operations not proven |
| Customer validation / ROI | Not yet evidenced | No measured real-customer pilot |

### Ranked improvement plan

**P0 — protect the product and make the demo trustworthy**
1. Keep the public judge demo separate from any future private tenant data.
2. Keep signed-session login/logout, request-scoped tenant resolution, PostgreSQL RLS and cross-tenant tests intact. Before accepting real customer data, redesign password-reset table/function ownership so the runtime cannot bypass RLS; validate on a disposable Neon branch.
3. Preserve durable webhook idempotency and order-to-tenant routing; maintain replay, concurrent-delivery, unknown-order and mismatch tests. Independently verify a real signed Sandbox webhook delivery before claiming live delivery.
4. The current live ledger shows zero verified captures. If a fresh Sandbox transaction is later explicitly authorised, verify buyer approval → server capture → audit and show the evidence. Do not infer a live capture or webhook from configuration or unit tests.

**P1 — close the highest-value workflow gaps without fake integrations**
5. Add manually recorded promise-to-pay date, source, and status; automatically pause routine reminders until the promised date and flag missed promises for human review.
6. Upgrade disputes into a small case workflow: reason, owner, next-review date, resolution note and full audit history. Never auto-clear a dispute.
7. Add a deterministic expected-cash view grouped by currency with explicit scenarios and no ML payment-probability claims.
8. Add robust CSV import/export with preview, validation, duplicate detection and a reversible import log before building expensive accounting connectors.

**P2 — expand only when the foundation is proven**
9. Add one accounting connector (start with the target customers' most common system) with read-only sync first, then carefully scoped write-back.
10. Add customer-facing payment status and secure portal only after tenancy, roles and access controls pass.
11. Add inbox/email integration only with explicit mailbox authorization, source-linked extracted replies and human review for disputes/promises.
12. Add a second payment rail only behind a provider adapter and a shared idempotent payment state machine.

### Sources used for this market benchmark

- [Upflow's 2026 AI agents comparison](https://upflow.io/blog/accounting-software/accounts-receivable-ai-agents) — useful feature-level comparison of Upflow, Chaser, Gaviti, Kolleno, Paraglide, Quadient, Stuut, Tesorio and Versapay. It is published by a market participant, so treat its comparative ratings and competitor commentary as interested-party analysis.
- [Kolleno product overview](https://www.kolleno.com/) — vendor-described collections, payments, cash application, disputes, credit risk, forecasting and security controls.
- [Tesorio product overview](https://www.tesorio.com/) — vendor-described collections, cash application, supplier portal agents, forecasting, MCP and governance.
- [PayPal developer security guidelines](https://developer.paypal.com/security-guidelines) and [webhook integration guide](https://developer.paypal.com/api/rest/webhooks/rest/) — primary-source security requirements for OAuth, secret handling, HTTPS and webhook verification.
- [G2's 2026 AR software evaluation](https://learn.g2.com/best-accounts-receivable-software) — buyer-relevant criteria including payment methods, portals, integrations, reconciliation, reporting and pricing.
- [Software Advice AR buyer research](https://www.softwareadvice.com/accounting/accounts-receivable-comparison/) — recurring buyer pain around manual workflows, integration limits, payment-method flexibility and ERP cost/complexity.

### What this benchmark does not prove

It does not establish that any vendor's marketing claims work for every customer, that competitor code is more secure, or that PayPilot will win a hackathon. The ratings above describe relative product coverage from publicly available information, not a laboratory benchmark. Re-check vendor features and hackathon rules before making public comparative claims.
