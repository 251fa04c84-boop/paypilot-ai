'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runSafetyLab } = require('../lib/safety-lab');

test('all deterministic recovery safety checks pass without provider calls or mutations', () => {
  const result = runSafetyLab(Date.parse('2026-11-12T00:00:00.000Z'));
  assert.equal(result.mode, 'deterministic_policy_regression_checks');
  assert.equal(result.total, 22);
  assert.equal(result.passed, 22);
  assert.equal(result.failed, 0);
  assert.equal(result.liveProviderCalls, false);
  assert.equal(result.modelCalls, false);
  assert.equal(result.mutations, 0);
  assert.ok(result.checks.every((x) => x.status === 'passed'));
  assert.match(result.disclaimer, /not a penetration test/);
});

test('safety checks are repeatable for the same timestamp', () => {
  const now = Date.parse('2026-11-12T00:00:00.000Z');
  assert.deepEqual(runSafetyLab(now), runSafetyLab(now));
});
