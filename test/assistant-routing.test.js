'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { processAssistantQuery } = require('../lib/agent');

test('generic cash-flow advice reaches configured AI instead of portfolio metrics', async () => {
  let aiCalls = 0;
  const result = await processAssistantQuery({
    query: 'Explain three practical ways a small business can manage cash flow when customers pay late.',
    invoices: [],
    db: {},
    ctx: { today: '2026-11-10', db: { orders: [] } },
    aiGenerate: async ({ prompt }) => {
      aiCalls++;
      assert.match(prompt, /USER QUESTION: Explain three practical ways/);
      return { ok: true, text: 'Track a rolling cash forecast, follow up on overdue receivables, and negotiate supplier payment terms.', source: 'gemini:test' };
    },
  });
  assert.equal(aiCalls, 1);
  assert.equal(result.source, 'gemini:test');
  assert.match(result.text, /rolling cash forecast/);
  assert.doesNotMatch(result.text, /verified recovery metrics/i);
});

test('explicit portfolio summary requests remain deterministic', async () => {
  let aiCalls = 0;
  const result = await processAssistantQuery({
    query: 'Show the portfolio summary.',
    invoices: [],
    db: {},
    ctx: { today: '2026-11-10', db: { orders: [] } },
    aiGenerate: async () => { aiCalls++; return { ok: true, text: 'should not run' }; },
  });
  assert.equal(aiCalls, 0);
  assert.equal(result.source, 'deterministic-tool:summarize');
  assert.match(result.text, /verified recovery metrics/i);
});
