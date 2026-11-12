'use strict';

function buildTrustStatus({
  pgMode,
  authEnabled,
  webhookConfigured,
  aiConfigured,
  emailConfigured,
  publicDemoMutationsEnabled,
}) {
  return {
    controls: {
      humanApproval: true,
      approvalTtlMinutes: 30,
      serverSideCaptureVerification: true,
      signedWebhookVerification: Boolean(webhookConfigured),
      webhookConfigured: Boolean(webhookConfigured),
      webhookDeliveryVerified: false,
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
      'PayPal webhook delivery has not been independently verified in this environment; a configured webhook ID is not proof of event delivery.',
      ...(!emailConfigured ? ['Transactional email provider is not configured.'] : []),
      'Transactional email delivery has not been independently verified; provider configuration or an accepted reset request is not proof of inbox delivery.',
      ...(!authEnabled ? ['Private signed-session accounts are not enabled.'] : []),
      ...(publicDemoMutationsEnabled ? ['Public judge-demo actions can change shared synthetic records; do not enter personal or confidential data.'] : []),
    ],
  };
}

module.exports = { buildTrustStatus };
