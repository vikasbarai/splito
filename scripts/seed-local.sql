-- Local development data only. Do not run this file against --remote.
-- Demo-user password: DemoPass123!

PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO users (name, email, password_hash)
VALUES
  ('Alex Morgan', 'alex.morgan@example.invalid', 'splito-local-demo-v1:WYUamS3r5wDkkMeMDGMTRpLUjAw14wy-7CLylmXNNdE'),
  ('Maya Rao', 'maya.rao@example.invalid', 'splito-local-demo-v1:WYUamS3r5wDkkMeMDGMTRpLUjAw14wy-7CLylmXNNdE'),
  ('Arjun Shah', 'arjun.shah@example.invalid', 'splito-local-demo-v1:WYUamS3r5wDkkMeMDGMTRpLUjAw14wy-7CLylmXNNdE'),
  ('Priya Kapoor', 'priya.kapoor@example.invalid', 'splito-local-demo-v1:WYUamS3r5wDkkMeMDGMTRpLUjAw14wy-7CLylmXNNdE');

INSERT INTO groups (name, emoji, created_by)
SELECT 'Weekend Getaway', 'W', id
FROM users
WHERE email = 'alex.morgan@example.invalid'
  AND NOT EXISTS (
    SELECT 1 FROM groups WHERE name = 'Weekend Getaway'
  );

INSERT INTO groups (name, emoji, created_by)
SELECT 'Project Lunch Club', 'L', id
FROM users
WHERE email = 'maya.rao@example.invalid'
  AND NOT EXISTS (
    SELECT 1 FROM groups WHERE name = 'Project Lunch Club'
  );

-- Add every user already in this local database, as well as the demo users,
-- to the sample groups. This makes the groups visible from existing accounts.
INSERT OR IGNORE INTO group_members (group_id, user_id)
SELECT groups.id, users.id
FROM groups
CROSS JOIN users
WHERE groups.name IN ('Weekend Getaway', 'Project Lunch Club');

-- This shared expense includes every member already in the local database,
-- so existing accounts have a meaningful balance in the sample data.
INSERT INTO expenses (
  group_id,
  description,
  amount_cents,
  paid_by,
  category,
  expense_date,
  notes
)
SELECT
  groups.id,
  'Welcome snacks',
  (SELECT COUNT(*) FROM group_members WHERE group_id = groups.id) * 1000,
  users.id,
  'food',
  '2026-09-04',
  'Sample local data shared by every group member'
FROM groups
JOIN users ON users.email = 'alex.morgan@example.invalid'
WHERE groups.name = 'Weekend Getaway'
  AND NOT EXISTS (
    SELECT 1
    FROM expenses
    WHERE expenses.group_id = groups.id
      AND expenses.description = 'Welcome snacks'
  );

INSERT OR IGNORE INTO expense_splits (expense_id, user_id, amount_cents)
SELECT expenses.id, group_members.user_id, 1000
FROM expenses
JOIN groups ON groups.id = expenses.group_id
JOIN group_members ON group_members.group_id = groups.id
WHERE groups.name = 'Weekend Getaway'
  AND expenses.description = 'Welcome snacks';

INSERT INTO expenses (
  group_id,
  description,
  amount_cents,
  paid_by,
  category,
  expense_date,
  notes
)
SELECT groups.id, 'Villa booking', 150000, users.id, 'travel', '2026-09-05', 'Sample local data'
FROM groups
JOIN users ON users.email = 'alex.morgan@example.invalid'
WHERE groups.name = 'Weekend Getaway'
  AND NOT EXISTS (
    SELECT 1
    FROM expenses
    WHERE expenses.group_id = groups.id
      AND expenses.description = 'Villa booking'
  );

INSERT OR IGNORE INTO expense_splits (expense_id, user_id, amount_cents)
SELECT expenses.id, users.id, 37500
FROM expenses
JOIN groups ON groups.id = expenses.group_id
JOIN users ON users.email IN (
  'alex.morgan@example.invalid',
  'maya.rao@example.invalid',
  'arjun.shah@example.invalid',
  'priya.kapoor@example.invalid'
)
WHERE groups.name = 'Weekend Getaway'
  AND expenses.description = 'Villa booking';

INSERT INTO expenses (
  group_id,
  description,
  amount_cents,
  paid_by,
  category,
  expense_date,
  notes
)
SELECT groups.id, 'Groceries', 6200, users.id, 'food', '2026-09-06', 'Sample local data'
FROM groups
JOIN users ON users.email = 'maya.rao@example.invalid'
WHERE groups.name = 'Weekend Getaway'
  AND NOT EXISTS (
    SELECT 1
    FROM expenses
    WHERE expenses.group_id = groups.id
      AND expenses.description = 'Groceries'
  );

INSERT OR IGNORE INTO expense_splits (expense_id, user_id, amount_cents)
SELECT expenses.id, users.id, 1550
FROM expenses
JOIN groups ON groups.id = expenses.group_id
JOIN users ON users.email IN (
  'alex.morgan@example.invalid',
  'maya.rao@example.invalid',
  'arjun.shah@example.invalid',
  'priya.kapoor@example.invalid'
)
WHERE groups.name = 'Weekend Getaway'
  AND expenses.description = 'Groceries';

INSERT INTO expenses (
  group_id,
  description,
  amount_cents,
  paid_by,
  category,
  expense_date,
  notes
)
SELECT groups.id, 'Team lunch', 3600, users.id, 'food', '2026-09-08', 'Sample local data'
FROM groups
JOIN users ON users.email = 'arjun.shah@example.invalid'
WHERE groups.name = 'Project Lunch Club'
  AND NOT EXISTS (
    SELECT 1
    FROM expenses
    WHERE expenses.group_id = groups.id
      AND expenses.description = 'Team lunch'
  );

INSERT OR IGNORE INTO expense_splits (expense_id, user_id, amount_cents)
SELECT expenses.id, users.id, 1200
FROM expenses
JOIN groups ON groups.id = expenses.group_id
JOIN users ON users.email IN (
  'alex.morgan@example.invalid',
  'maya.rao@example.invalid',
  'arjun.shah@example.invalid'
)
WHERE groups.name = 'Project Lunch Club'
  AND expenses.description = 'Team lunch';

INSERT INTO settlements (group_id, paid_by, paid_to, amount_cents, settled_at)
SELECT groups.id, payer.id, recipient.id, 1000, '2026-09-09 12:00:00'
FROM groups
JOIN users AS payer ON payer.email = 'priya.kapoor@example.invalid'
JOIN users AS recipient ON recipient.email = 'alex.morgan@example.invalid'
WHERE groups.name = 'Weekend Getaway'
  AND NOT EXISTS (
    SELECT 1
    FROM settlements
    WHERE settlements.group_id = groups.id
      AND settlements.paid_by = payer.id
      AND settlements.paid_to = recipient.id
      AND settlements.amount_cents = 1000
      AND settlements.settled_at = '2026-09-09 12:00:00'
  );
