ALTER TABLE users ADD COLUMN email_verified_at TEXT;

-- Accounts that existed before email verification was introduced retain access.
UPDATE users
SET email_verified_at = CURRENT_TIMESTAMP
WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS email_verification_tokens_user_id
  ON email_verification_tokens(user_id);

CREATE TABLE IF NOT EXISTS group_creation_events (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS group_creation_events_user_created_at
  ON group_creation_events(user_id, created_at);

CREATE INDEX IF NOT EXISTS invites_group_inviter_created_at
  ON invites(group_id, invited_by, created_at);

CREATE INDEX IF NOT EXISTS invites_group_email_pending
  ON invites(group_id, email, accepted_at);

CREATE INDEX IF NOT EXISTS invites_email_created_at
  ON invites(email, created_at);
