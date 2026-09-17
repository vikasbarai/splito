const express = require("express");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET =
  process.env.JWT_SECRET || "change-this-before-production";
fs.mkdirSync(path.join(__dirname, "data"), {
  recursive: true,
});
const db = new Database(
  path.join(__dirname, "data", "splito.db"),
);
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL, emoji TEXT DEFAULT '✦', created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS group_members (group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, joined_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(group_id,user_id));
CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, description TEXT NOT NULL, amount_cents INTEGER NOT NULL, paid_by INTEGER NOT NULL REFERENCES users(id), category TEXT DEFAULT 'other', expense_date TEXT NOT NULL, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS expense_splits (expense_id INTEGER REFERENCES expenses(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id), amount_cents INTEGER NOT NULL, PRIMARY KEY(expense_id,user_id));
CREATE TABLE IF NOT EXISTS settlements (id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, paid_by INTEGER NOT NULL REFERENCES users(id), paid_to INTEGER NOT NULL REFERENCES users(id), amount_cents INTEGER NOT NULL, settled_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS invites (id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, email TEXT NOT NULL, token TEXT NOT NULL UNIQUE, invited_by INTEGER REFERENCES users(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP, accepted_at TEXT);
`);
app.use(express.json());
app.use(express.static(__dirname));
const bad = (res, message, status = 400) =>
  res.status(status).json({ error: message });
const tokenFor = (user) =>
  jwt.sign({ id: user.id, email: user.email }, SECRET, {
    expiresIn: "30d",
  });
function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace(
    "Bearer ",
    "",
  );
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return bad(res, "Please sign in.", 401);
  }
}
function member(userId, groupId) {
  return !!db
    .prepare(
      "SELECT 1 FROM group_members WHERE group_id=? AND user_id=?",
    )
    .get(groupId, userId);
}
function groupOr403(req, res, next) {
  const id = Number(req.params.groupId || req.params.id);
  if (!Number.isInteger(id) || !member(req.user.id, id))
    return bad(
      res,
      "You are not a member of this group.",
      403,
    );
  req.groupId = id;
  next();
}
function userRow(id) {
  return db
    .prepare("SELECT id,name,email FROM users WHERE id=?")
    .get(id);
}
function calcGroup(groupId) {
  const map = new Map(
    db
      .prepare(
        "SELECT u.id,u.name,u.email FROM users u JOIN group_members gm ON gm.user_id=u.id WHERE gm.group_id=?",
      )
      .all(groupId)
      .map((u) => [u.id, { ...u, balance_cents: 0 }]),
  );
  db.prepare(
    "SELECT e.id,e.paid_by,e.amount_cents FROM expenses e WHERE e.group_id=?",
  )
    .all(groupId)
    .forEach((e) => {
      map.get(e.paid_by).balance_cents += e.amount_cents;
      db.prepare(
        "SELECT user_id,amount_cents FROM expense_splits WHERE expense_id=?",
      )
        .all(e.id)
        .forEach(
          (s) =>
            (map.get(s.user_id).balance_cents -=
              s.amount_cents),
        );
    });
  db.prepare(
    "SELECT paid_by,paid_to,amount_cents FROM settlements WHERE group_id=?",
  )
    .all(groupId)
    .forEach((s) => {
      map.get(s.paid_by).balance_cents += s.amount_cents;
      map.get(s.paid_to).balance_cents -= s.amount_cents;
    });
  return [...map.values()];
}
app.post("/api/auth/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (
    !name?.trim() ||
    !email?.includes("@") ||
    !password ||
    password.length < 6
  )
    return bad(
      res,
      "Enter a name, valid email, and password of at least 6 characters.",
    );
  try {
    const info = db
      .prepare(
        "INSERT INTO users(name,email,password_hash) VALUES(?,?,?)",
      )
      .run(
        name.trim(),
        email.toLowerCase().trim(),
        await bcrypt.hash(password, 10),
      );
    const user = userRow(info.lastInsertRowid);
    res.status(201).json({ user, token: tokenFor(user) });
  } catch (e) {
    bad(
      res,
      e.message.includes("UNIQUE")
        ? "That email is already registered."
        : "Could not create account.",
    );
  }
});
app.post("/api/auth/login", async (req, res) => {
  const user = db
    .prepare("SELECT * FROM users WHERE email=?")
    .get(req.body.email?.toLowerCase().trim());
  if (
    !user ||
    !(await bcrypt.compare(
      req.body.password || "",
      user.password_hash,
    ))
  )
    return bad(res, "Incorrect email or password.", 401);
  res.json({
    user: userRow(user.id),
    token: tokenFor(user),
  });
});
app.get("/api/me", auth, (req, res) =>
  res.json({ user: userRow(req.user.id) }),
);
app.get("/api/dashboard", auth, (req, res) => {
  const groups = db
    .prepare(
      `SELECT g.*,(SELECT COUNT(*) FROM group_members gm WHERE gm.group_id=g.id) member_count FROM groups g JOIN group_members mine ON mine.group_id=g.id WHERE mine.user_id=? ORDER BY g.created_at DESC`,
    )
    .all(req.user.id)
    .map((g) => ({ ...g, balances: calcGroup(g.id) }));
  const activity = db
    .prepare(
      `SELECT e.*,g.name group_name,u.name payer_name FROM expenses e JOIN groups g ON g.id=e.group_id JOIN users u ON u.id=e.paid_by JOIN group_members gm ON gm.group_id=g.id WHERE gm.user_id=? ORDER BY e.created_at DESC LIMIT 20`,
    )
    .all(req.user.id);
  res.json({ groups, activity });
});
app.post("/api/groups", auth, (req, res) => {
  const { name, emoji = "✦" } = req.body;
  if (!name?.trim())
    return bad(res, "A group name is required.");
  const tx = db.transaction(() => {
    const g = db
      .prepare(
        "INSERT INTO groups(name,emoji,created_by) VALUES(?,?,?)",
      )
      .run(name.trim(), emoji.slice(0, 4), req.user.id);
    db.prepare(
      "INSERT INTO group_members(group_id,user_id) VALUES(?,?)",
    ).run(g.lastInsertRowid, req.user.id);
    return g.lastInsertRowid;
  });
  const id = tx();
  res.status(201).json({ id });
});
app.get(
  "/api/groups/:groupId",
  auth,
  groupOr403,
  (req, res) => {
    const group = db
      .prepare("SELECT * FROM groups WHERE id=?")
      .get(req.groupId);
    const members = db
      .prepare(
        "SELECT u.id,u.name,u.email FROM users u JOIN group_members gm ON gm.user_id=u.id WHERE gm.group_id=?",
      )
      .all(req.groupId);
    const expenses = db
      .prepare(
        `SELECT e.*,u.name payer_name FROM expenses e JOIN users u ON u.id=e.paid_by WHERE e.group_id=? ORDER BY e.expense_date DESC,e.created_at DESC`,
      )
      .all(req.groupId)
      .map((e) => ({
        ...e,
        splits: db
          .prepare(
            "SELECT s.*,u.name FROM expense_splits s JOIN users u ON u.id=s.user_id WHERE expense_id=?",
          )
          .all(e.id),
      }));
    const settlements = db
      .prepare(
        "SELECT s.*,a.name payer_name,b.name payee_name FROM settlements s JOIN users a ON a.id=s.paid_by JOIN users b ON b.id=s.paid_to WHERE s.group_id=? ORDER BY s.settled_at DESC",
      )
      .all(req.groupId);
    res.json({
      group,
      members,
      expenses,
      settlements,
      balances: calcGroup(req.groupId),
    });
  },
);
app.post(
  "/api/groups/:groupId/invites",
  auth,
  groupOr403,
  (req, res) => {
    const email = req.body.email?.toLowerCase().trim();
    if (!email?.includes("@"))
      return bad(res, "Enter a valid email.");
    const token = require("crypto").randomUUID();
    db.prepare(
      "INSERT INTO invites(group_id,email,token,invited_by) VALUES(?,?,?,?)",
    ).run(req.groupId, email, token, req.user.id);
    res.status(201).json({
      token,
      inviteUrl: `${req.protocol}://${req.get("host")}/?invite=${token}`,
    });
  },
);
app.post("/api/invites/:token/accept", auth, (req, res) => {
  const inv = db
    .prepare(
      "SELECT * FROM invites WHERE token=? AND accepted_at IS NULL",
    )
    .get(req.params.token);
  if (!inv)
    return bad(
      res,
      "This invite is invalid or already used.",
      404,
    );
  if (inv.email !== req.user.email)
    return bad(
      res,
      "Sign in with the email that received this invitation.",
      403,
    );
  db.prepare(
    "INSERT OR IGNORE INTO group_members(group_id,user_id) VALUES(?,?)",
  ).run(inv.group_id, req.user.id);
  db.prepare(
    "UPDATE invites SET accepted_at=CURRENT_TIMESTAMP WHERE id=?",
  ).run(inv.id);
  res.json({ groupId: inv.group_id });
});
app.post(
  "/api/groups/:groupId/expenses",
  auth,
  groupOr403,
  (req, res) => {
    const {
      description,
      amount,
      paidBy,
      participants,
      category = "other",
      date,
      notes,
    } = req.body;
    const cents = Math.round(Number(amount) * 100),
      payer = Number(paidBy);
    if (
      !description?.trim() ||
      !Number.isSafeInteger(cents) ||
      cents < 1
    )
      return bad(
        res,
        "Add a description and a valid amount.",
      );
    if (!member(payer, req.groupId))
      return bad(res, "The payer must be in this group.");
    const ids = [
      ...new Set((participants || []).map(Number)),
    ];
    if (
      !ids.length ||
      ids.some((id) => !member(id, req.groupId))
    )
      return bad(res, "Choose one or more group members.");
    const tx = db.transaction(() => {
      const e = db
        .prepare(
          "INSERT INTO expenses(group_id,description,amount_cents,paid_by,category,expense_date,notes) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          req.groupId,
          description.trim(),
          cents,
          payer,
          category,
          date || new Date().toISOString().slice(0, 10),
          notes || null,
        );
      const each = Math.floor(cents / ids.length),
        remainder = cents % ids.length;
      ids.forEach((id, i) =>
        db
          .prepare(
            "INSERT INTO expense_splits(expense_id,user_id,amount_cents) VALUES(?,?,?)",
          )
          .run(
            e.lastInsertRowid,
            id,
            each + (i < remainder ? 1 : 0),
          ),
      );
      return e.lastInsertRowid;
    });
    res.status(201).json({ id: tx() });
  },
);
app.delete("/api/expenses/:id", auth, (req, res) => {
  const expense = db
    .prepare("SELECT * FROM expenses WHERE id=?")
    .get(req.params.id);
  if (!expense || !member(req.user.id, expense.group_id))
    return bad(res, "Expense not found.", 404);
  if (expense.paid_by !== req.user.id)
    return bad(
      res,
      "Only the person who added this expense can delete it.",
      403,
    );
  db.prepare("DELETE FROM expenses WHERE id=?").run(
    expense.id,
  );
  res.status(204).end();
});
app.post(
  "/api/groups/:groupId/settlements",
  auth,
  groupOr403,
  (req, res) => {
    const { paidTo, amount } = req.body,
      cents = Math.round(Number(amount) * 100),
      to = Number(paidTo);
    if (
      !Number.isSafeInteger(cents) ||
      cents < 1 ||
      !member(to, req.groupId) ||
      to === req.user.id
    )
      return bad(
        res,
        "Choose a group member and a valid amount.",
      );
    db.prepare(
      "INSERT INTO settlements(group_id,paid_by,paid_to,amount_cents) VALUES(?,?,?,?)",
    ).run(req.groupId, req.user.id, to, cents);
    res.status(201).json({ ok: true });
  },
);
app.get("*", (req, res) =>
  res.sendFile(path.join(__dirname, "index.html")),
);
app.listen(PORT, () =>
  console.log(`Splito running at http://localhost:${PORT}`),
);
