ALTER TABLE expenses ADD COLUMN deleted_at TEXT;
ALTER TABLE expenses ADD COLUMN deleted_by INTEGER REFERENCES users(id);
ALTER TABLE expenses ADD COLUMN updated_at TEXT;
ALTER TABLE expenses ADD COLUMN updated_by INTEGER REFERENCES users(id);

ALTER TABLE settlements ADD COLUMN deleted_at TEXT;
ALTER TABLE settlements ADD COLUMN deleted_by INTEGER REFERENCES users(id);
ALTER TABLE settlements ADD COLUMN updated_at TEXT;
ALTER TABLE settlements ADD COLUMN updated_by INTEGER REFERENCES users(id);

CREATE TABLE IF NOT EXISTS expense_history (
  id INTEGER PRIMARY KEY,
  original_expense_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  emoji TEXT,
  split_method TEXT,
  amount_cents INTEGER NOT NULL,
  paid_by INTEGER NOT NULL,
  category TEXT,
  expense_date TEXT NOT NULL,
  notes TEXT,
  receipt_image TEXT,
  original_created_at TEXT,
  history_action TEXT NOT NULL CHECK(history_action IN ('edited','deleted')),
  archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS expense_history_splits (
  history_id INTEGER NOT NULL REFERENCES expense_history(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL,
  PRIMARY KEY(history_id,user_id)
);

CREATE TABLE IF NOT EXISTS settlement_history (
  id INTEGER PRIMARY KEY,
  original_settlement_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  paid_by INTEGER NOT NULL,
  paid_to INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  settled_at TEXT NOT NULL,
  receipt_image TEXT,
  original_created_at TEXT,
  history_action TEXT NOT NULL CHECK(history_action IN ('edited','deleted')),
  archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_by INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS expense_history_group_id
  ON expense_history(group_id, archived_at);

CREATE INDEX IF NOT EXISTS settlement_history_group_id
  ON settlement_history(group_id, archived_at);

CREATE INDEX IF NOT EXISTS expenses_active_group_id
  ON expenses(group_id, deleted_at);

CREATE INDEX IF NOT EXISTS settlements_active_group_id
  ON settlements(group_id, deleted_at);
