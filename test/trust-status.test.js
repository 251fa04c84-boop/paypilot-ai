'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTrustStatus } = require('../lib/trust-status');

test('distinguishes configured integrations from independently verified delivery', () => {
  const result = buildTrustStatus({
    pgMode: true, authEnabled: true, webhookConfigured: true,
    aiConfigured: true, emailConfigured: true, publicDemoMutationsEnabled: true, passwordResetIsolation: true,
  });
  assert.equal(result.controls.webhookConfigured, true);
  assert.equal(result.controls.webhookDeliveryVerified, false);
  assert.equal(result.controls.webhookSimulatorVerified, false);
  assert.equal(result.controls.emailConfigured, true);
  assert.equal(result.controls.emailDeliveryVerified, false);
  assert.equal(result.controls.tenantScopedStorage, true);
  assert.equal(result.controls.signedSessions, true);
  assert.equal(result.controls.passwordResetIsolation, true);
  assert.ok(result.caveats.some((x) => x.includes('real PayPal Sandbox transaction webhook has not yet been independently verified')));
  assert.ok(result.caveats.some((x) => x.includes('email delivery has not been independently verified')));
  assert.ok(result.caveats.some((x) => x.includes('shared synthetic records')));
});

test('reports missing infrastructure without claiming it is configured', () => {
  const result = buildTrustStatus({
    pgMode: false, authEnabled: false, webhookConfigured: false,
    aiConfigured: false, emailConfigured: false, publicDemoMutationsEnabled: false, passwordResetIsolation: false,
  });
  assert.equal(result.controls.tenantScopedStorage, false);
  assert.equal(result.controls.signedSessions, false);
  assert.equal(result.controls.webhookConfigured, false);
  assert.equal(result.controls.emailConfigured, false);
  assert.equal(result.controls.publicDemoMutations, false);
  assert.equal(result.controls.passwordResetIsolation, false);
  assert.ok(result.caveats.some((x) => x.toLowerCase().includes('password-reset token storage')));
  assert.ok(result.caveats.some((x) => x.includes('PayPal webhook ID is not configured')));
  assert.ok(result.caveats.some((x) => x.includes('Transactional email provider is not configured')));
});


test('reports a verified mock simulator separately from real webhook delivery', () => {
  const result = buildTrustStatus({
    pgMode: true, authEnabled: true, webhookConfigured: true,
    aiConfigured: true, emailConfigured: true, publicDemoMutationsEnabled: false,
    webhookSimulatorVerified: true, passwordResetIsolation: true,
  });
  assert.equal(result.controls.webhookSimulatorVerified, true);
  assert.equal(result.controls.webhookDeliveryVerified, false);
  assert.ok(result.caveats.some((x) => x.includes('mock event')));
});


test('reports real signed webhook delivery separately from the mock simulator', () => {
  const result = buildTrustStatus({
    pgMode: true, authEnabled: true, webhookConfigured: true,
    aiConfigured: true, emailConfigured: true, publicDemoMutationsEnabled: false,
    webhookSimulatorVerified: true, passwordResetIsolation: true,
    webhookDeliveryVerified: true,
  });
  assert.equal(result.controls.webhookDeliveryVerified, true);
  assert.equal(result.controls.webhookSimulatorVerified, true);
  assert.ok(result.caveats.some((x) => x.includes('real signed PayPal Sandbox webhook reached staging')));
  assert.ok(!result.caveats.some((x) => x.includes('has not yet been independently verified')));
});
