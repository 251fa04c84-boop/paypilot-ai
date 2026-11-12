'use strict';

function buildTrustStatus({
  pgMode,
  authEnabled,
  webhookConfigured,
  aiConfigured,
  emailConfigured,
  publicDemoMutationsEnabled,
  webhookSimulatorVerified,
}) {
  return {
    controls: {
      humanApproval: true,
      approvalTtlMinutes: 30,
      serverSideCaptureVerification: true,
      signedWebhookVerification: Boolean(webhookConfigured),
      webhookConfigured: Boolean(webhookConfigured),
      webhookDeliveryVerified: false,
      webhookSimulatorVerified: Boolean(webhookSimulatorVerified),
      tenantScopedStorage: Boolean(pgMode),
      signedSessions: Boolean(authEnabled),
      auditLog: true,
      aiOptional: true,
      aiConfigured: Boolean(aiConfigured),
      emailConfigured: Boolean(emailConfigured),
      emailDeliveryVerified: false,
      publicDemoMutations: Boolean(publicDemoMutationsEnabled),
    },
    caveats: [
      ...(!pgMode ? ['PostgreSQL tenant-scoped storage is not active in this environment.'] : []),
      ...(!webhookConfigured ? ['PayPal webhook ID is not configured.'] : []),
      ...(webhookSimulatorVerified ? ['A PayPal-signed simulator event reached staging and passed signature verification; it is a mock event, not a real buyer payment or proof of a registered production webhook delivery.'] : []),
      'A real PayPal Sandbox transaction webhook has not yet been independently verified; a configured webhook ID or mock simulator event is not proof of a real capture event.',
      ...(!emailConfigured ? ['Transactional email provider is not configured.'] : []),
      'Transactional email delivery has not been independently verified; provider configuration or an accepted reset request is not proof of inbox delivery.',
      ...(!authEnabled ? ['Private signed-session accounts are not enabled.'] : []),
      ...(publicDemoMutationsEnabled ? ['Public judge-demo actions can change shared synthetic records; do not enter personal or confidential data.'] : []),
    ],
  };
}

module.exports = { buildTrustStatus };
