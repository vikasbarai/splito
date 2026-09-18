CREATE TABLE IF NOT EXISTS friendships (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, friend_id),
  CHECK (user_id < friend_id)
);

CREATE INDEX IF NOT EXISTS friendships_friend_id
  ON friendships(friend_id);

ALTER TABLE invites ADD COLUMN add_to_friends INTEGER NOT NULL DEFAULT 0;
