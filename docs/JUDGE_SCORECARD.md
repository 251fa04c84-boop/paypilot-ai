# PayPilot AI — judge scorecard and winning strategy

This is an internal product strategy document, not a claim of judge scores or a guarantee of placement.

## Competition rubric

The PayPal AI Hackathon lists five equally weighted criteria. Stage one is a pass/fail viability check: the project must fit the theme and meaningfully use PayPal. The five scored categories are technological implementation, design, potential impact, innovation/idea, and presentation.

| Category | Judge's likely question | PayPilot evidence | Remaining work |
|---|---|---|---|
| Technological implementation | Is PayPal central, is AI meaningful, and is the implementation non-trivial? | PayPal Orders v2 Sandbox, server-side capture verification, signed webhook verification, Gemini interpretation, deterministic agent tools, approval revalidation, audit events | Re-run all tests on current branch; verify current deployed version; document exact Sandbox setup; add durable storage only with a fully tested migration |
| Design | Does this feel like a complete product? | Mission Control, financial snapshot grouped by currency, recovery queue, approval inbox, invoice evidence view, assistant, activity export | Verify refreshed layout in real mobile and desktop browsers; test empty/error/loading states and keyboard access; refine detail and approvals screens |
| Potential impact | Is the user and problem specific, and is the benefit credible? | Small businesses managing overdue invoices; portfolio triage, dispute pause, reduced manual prioritisation and auditable workflow | Validate with real small-business operators if possible; measure time-to-prioritise and recovery outcomes; do not turn demo data into impact claims |
| Innovation / idea | Why is this different from existing invoice reminders or chatbots? | Portfolio-level recovery plan with evidence, human authority, bounded actions and PayPal-verified settlement | Make the difference obvious in first 20 seconds; show disputed and already-paid safety paths; avoid claims of autonomous money control |
| Presentation | Can judges understand and see it work end-to-end? | Hosted app, judge guide, reproducible overdue/dispute/paid/injection scenarios, Sandbox payment path | Record a public YouTube video under 3 minutes; ensure it shows the live app, real Sandbox buyer approval, server verification and audit result |

## Positioning

**One-line product claim:** PayPilot is an evidence-first receivables recovery agent that prioritises unpaid invoices, proposes bounded actions for human approval, and verifies PayPal Sandbox payment before recording settlement.

**Core differentiation:** the complete chain from portfolio triage → evidence-backed plan → explicit approval → allowlisted execution → PayPal verification → audit.

Do not claim:
- that the urgency score predicts payment probability;
- that Gemini makes payment or eligibility decisions;
- that PayPilot sends email or SMS;
- that simulated webhook events are real PayPal webhooks;
- that the application is multi-tenant or production-ready;
- that a Sandbox payment moves real money;
- that demo data proves customer impact.

## Sponsor prize decision

- AG Grid has the most attractive listed cash sponsor prize, but the project should only enter that category if AG Grid is genuinely integrated into a useful workflow (for example, a sortable/filterable receivables workbench with grouped currency and action status) and the actual AG Grid tool requirement is satisfied. Do not add a logo or unused dependency to claim eligibility.
- APIMatic, Bryntum and Channel3 should be considered only if their tools materially improve PayPilot. Their integration must be real, disclosed and reproducible.
- Render sponsor awards are credits, not cash; they should not distract from the grand prize or cash honorable mentions.

## Release gates

1. Keep changes isolated on reviewable branches until the relevant tests pass.
2. Require the complete Node 22 test workflow to pass before merging.
3. Render is configured for automatic deployment from `main`; after each merge, verify that the exact merged commit is deployed and healthy before claiming the live demo contains the change.
4. Check the live hosted app separately; a green test suite does not prove a live Sandbox transaction or live webhook delivery.
5. The final submission must link the public repo, hosted demo, tool disclosure, complete description and public YouTube video under three minutes.
6. The demo must use test records and PayPal Sandbox credentials only.

## Current competitor benchmark (public Devpost descriptions, checked 8 Nov 2026)

These are competitors' published claims, not independently verified product audits.

- **[Unstuck](https://devpost.com/software/unstuck-ipxchy)** is the closest direct receivables competitor. Its public description claims PayPal Invoicing v2 cause-specific remedies, client-facing payment plans, Gemini diagnosis, AG Grid/AG Studio, and 276 automated tests. It also explicitly says actions/client payments are simulated and sandbox writes/webhooks are not yet verified live. Its breadth and root-cause narrative are stronger than PayPilot's today; PayPilot's strongest counter-evidence is its independently observed buyer-approved Sandbox capture and server-side settlement verification.
- **[Cross-Border Reconciliation Agent](https://devpost.com/software/paypal-reconciliation-agent)** competes strongly on technical breadth: its public page claims 178 Sandbox ledger rows, multiple PayPal API families, 170 logged actions, and end-to-end Sandbox cycles. Its primary problem is reconciliation, not small-business recovery.
- **[CartSplit AI](https://devpost.com/software/cartsplit-ai-paypal-ai-hackathon-2026-demo)** targets agentic commerce and group payments with Channel3, APIMatic, Orders and Invoicing APIs. It is less directly comparable to receivables recovery, but it raises the bar for visible multi-agent workflows and sponsor-tool integration.

### Competitive response

Do not imitate every competitor feature or add sponsor logos/dependencies without meaningful use. Prioritise evidence that PayPilot already does well: a real buyer-approved Sandbox checkout, strict server-side capture matching, dispute-aware blocking, stale-approval revalidation, and an auditable end-to-end recovery loop. To close the direct Unstuck gap, improve evidence-based diagnosis of *why* an invoice is unpaid only where the source record actually contains that evidence; clearly label missing client replies or payment promises as unknown. Do not invent root causes or claim real-world recovery-rate improvements from demo records.

## Demo story

1. Start in Mission Control and explain the portfolio-level problem.
2. Run the Autopilot sweep and show proposals in the approval queue.
3. Open an overdue invoice and separate facts, fixed rules, uncertainty and optional AI interpretation.
4. Show a dispute or already-paid invoice being blocked.
5. Approve a reminder draft and explain that the operator sends it outside PayPilot.
6. Start a PayPal Sandbox checkout, complete it with a Sandbox buyer, then show server-verified capture and the audit trail.
7. Close with the differentiator: prioritise with evidence, approve with control, verify the money.
