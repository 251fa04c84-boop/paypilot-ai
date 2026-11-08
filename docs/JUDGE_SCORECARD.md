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

1. A previously completed, buyer-approved PayPal Sandbox checkout and capture for Acme Studio D-1001 ($1,200 USD), with server-side invoice/amount/currency/completed-status verification. This historical transaction is not present in the reset live demo dataset.
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

1. Start in Mission Control and explain the portfolio-level problem.
2. Run the Autopilot sweep and show proposals in the approval queue.
3. Open an overdue invoice and separate facts, fixed rules, uncertainty and optional AI interpretation.
4. Show a dispute or already-paid invoice being blocked.
5. Approve a reminder draft and explain that the operator sends it outside PayPilot.
6. Start a PayPal Sandbox checkout, complete it with a Sandbox buyer, then show server-verified capture and the audit trail.
7. Close with the differentiator: prioritise with evidence, approve with control, verify the money.
