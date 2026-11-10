-- One-time, hashed password reset tokens for private accounts.
-- Apply with the account provisioning database role; never expose tokens in logs.
BEGIN;

CREATE TABLE IF NOT EXISTS public.paypilot_password_resets (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id UUID NOT NULL REFERENCES public.paypilot_users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS paypilot_password_resets_user_expiry
  ON public.paypilot_password_resets (user_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS paypilot_password_resets_expiry
  ON public.paypilot_password_resets (expires_at)
  WHERE consumed_at IS NULL;

COMMIT;
