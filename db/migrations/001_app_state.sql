CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_state (id, payload)
VALUES (1, '{"users":[],"predictions":[],"moderation":[],"rateLimits":[],"appeals":[],"sessions":[],"revokedTokens":[],"emailVerificationTokens":[],"passwordResetTokens":[]}'::jsonb)
ON CONFLICT (id) DO NOTHING;
