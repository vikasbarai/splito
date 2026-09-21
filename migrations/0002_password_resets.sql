ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id
  ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_at
  ON password_reset_tokens(expires_at);
