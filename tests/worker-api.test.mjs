import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import worker from "../worker.js";

const projectRoot = join(import.meta.dirname, "..");
const frontendUrl = "http://localhost:8000";
const testPassword = "Test password 123!";
const receipt = "data:image/jpeg;base64,/9j/2Q==";

class D1Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  execute(operation) {
    const statement = this.database.prepare(this.sql);
    if (operation === "all")
      return { results: statement.all(...this.values) };
    if (operation === "first")
      return statement.get(...this.values) || null;
    const result = statement.run(...this.values);
    return {
      success: true,
      meta: {
        changes: result.changes,
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }

  all() {
    return Promise.resolve(this.execute("all"));
  }

  first() {
    return Promise.resolve(this.execute("first"));
  }

  run() {
    return Promise.resolve(this.execute("run"));
  }
}

class D1Database {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new D1Statement(this.database, sql);
  }

  async batch(statements) {
    const runBatch = this.database.transaction((items) =>
      items.map((statement) => statement.execute("run")),
    );
    return runBatch(statements);
  }
}

function createEnvironment() {
  const database = new Database(":memory:");
  const migrationsDirectory = join(
    projectRoot,
    "migrations",
  );
  for (const migration of readdirSync(
    migrationsDirectory,
  ).sort())
    database.exec(
      readFileSync(
        join(migrationsDirectory, migration),
        "utf8",
      ),
    );
  return {
    database,
    env: {
      DB: new D1Database(database),
      JWT_SECRET: "local-test-jwt-secret",
      FRONTEND_URL: frontendUrl,
    },
  };
}

async function call(env, path, options = {}) {
  const { method = "GET", token, body } = options;
  const headers = new Headers({ Origin: frontendUrl });
  if (token)
    headers.set("Authorization", `Bearer ${token}`);
  if (body !== undefined)
    headers.set("Content-Type", "application/json");
  const response = await worker.fetch(
    new Request(`http://worker.test/api${path}`, {
      method,
      headers,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body) }),
    }),
    env,
  );
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null,
  };
}

async function register(
  env,
  name,
  email,
  password = testPassword,
) {
  const result = await call(env, "/auth/register", {
    method: "POST",
    body: { name, email, password },
  });
  assert.equal(result.status, 201, result.body?.error);
  return result.body;
}

async function verifyEmail(env, account) {
  const verificationToken = new URL(
    account.debugVerificationUrl,
  ).searchParams.get("verify");
  assert.ok(
    verificationToken,
    "local registration returns a usable email-verification token",
  );
  const result = await call(env, "/auth/verify-email", {
    method: "POST",
    body: { token: verificationToken },
  });
  assert.equal(result.status, 200, result.body?.error);
  return result.body;
}

function splitValues(participants, values) {
  return participants.map((userId, index) => ({
    userId,
    value: values[index],
  }));
}

function expenseData({
  description,
  paidBy,
  participants,
  splitMode = "equal",
  splits,
  receiptImage,
}) {
  return {
    description,
    emoji: "🍜",
    amount: "10.00",
    paidBy,
    participants,
    date: "2026-09-21",
    category: "food",
    notes: "API test expense",
    splitMode,
    ...(splits ? { splits } : {}),
    ...(receiptImage === undefined ? {} : { receiptImage }),
  };
}

async function muted(action) {
  const original = console.error;
  console.error = () => {};
  try {
    return await action();
  } finally {
    console.error = original;
  }
}

test("authentication, account settings, password reset, and CORS", async () => {
  const { database, env } = createEnvironment();
  try {
    const preflight = await worker.fetch(
      new Request("http://worker.test/api/auth/login", {
        method: "OPTIONS",
        headers: { Origin: frontendUrl },
      }),
      env,
    );
    assert.equal(preflight.status, 200);
    assert.equal(
      preflight.headers.get("access-control-allow-origin"),
      frontendUrl,
    );

    const account = await register(
      env,
      "Alice",
      "alice@example.test",
    );
    assert.equal(account.user.email_verified_at, null);
    const noSession = await call(env, "/me");
    assert.equal(noSession.status, 401);

    const resentVerification = await call(
      env,
      "/auth/resend-verification",
      { method: "POST", token: account.token },
    );
    assert.equal(
      resentVerification.status,
      200,
      resentVerification.body?.error,
    );
    const originalVerificationToken = new URL(
      account.debugVerificationUrl,
    ).searchParams.get("verify");
    const expiredOriginalVerification = await call(
      env,
      "/auth/verify-email",
      {
        method: "POST",
        body: { token: originalVerificationToken },
      },
    );
    assert.equal(expiredOriginalVerification.status, 400);

    const verified = await verifyEmail(env, {
      ...account,
      debugVerificationUrl:
        resentVerification.body.debugVerificationUrl,
    });
    assert.equal(
      verified.message,
      "Your email address has been verified.",
    );
    const verifiedAccount = await call(env, "/me", {
      token: account.token,
    });
    assert.ok(verifiedAccount.body.user.email_verified_at);

    const profile = await call(env, "/me", {
      method: "PUT",
      token: account.token,
      body: {
        name: "Alice Updated",
        email: "alice@example.test",
        avatarEmoji: "🌻",
        avatarImage: "data:image/png;base64,AA==",
        avatarColor: "#2f8f78",
      },
    });
    assert.equal(profile.status, 200, profile.body?.error);
    assert.equal(profile.body.user.name, "Alice Updated");
    assert.equal(profile.body.user.avatar_emoji, "🌻");
    assert.equal(profile.body.user.avatar_color, "#2f8f78");

    const current = await call(env, "/me", {
      token: profile.body.token,
    });
    assert.equal(current.status, 200);
    assert.equal(
      current.body.user.avatar_image,
      "data:image/png;base64,AA==",
    );

    const unknownAccount = await call(
      env,
      "/auth/forgot-password",
      {
        method: "POST",
        body: { email: "missing@example.test" },
      },
    );
    assert.equal(unknownAccount.status, 200);
    assert.equal(
      unknownAccount.body.message,
      "If an account exists for this email, a password-reset link will be sent.",
    );
    assert.equal(
      unknownAccount.body.debugResetUrl,
      undefined,
    );

    const forgotten = await call(
      env,
      "/auth/forgot-password",
      {
        method: "POST",
        body: { email: "alice@example.test" },
      },
    );
    assert.equal(
      forgotten.status,
      200,
      forgotten.body?.error,
    );
    assert.equal(
      forgotten.body.message,
      unknownAccount.body.message,
    );
    const resetToken = new URL(
      forgotten.body.debugResetUrl,
    ).searchParams.get("reset");
    assert.ok(
      resetToken,
      "local password reset returns a usable reset token",
    );

    const reset = await call(env, "/auth/reset-password", {
      method: "POST",
      body: {
        token: resetToken,
        newPassword: "Updated password 123!",
      },
    });
    assert.equal(reset.status, 200, reset.body?.error);

    const invalidatedToken = await call(env, "/me", {
      token: profile.body.token,
    });
    assert.equal(invalidatedToken.status, 401);

    const oldLogin = await call(env, "/auth/login", {
      method: "POST",
      body: {
        email: "alice@example.test",
        password: testPassword,
      },
    });
    assert.equal(oldLogin.status, 401);
    const newLogin = await call(env, "/auth/login", {
      method: "POST",
      body: {
        email: "alice@example.test",
        password: "Updated password 123!",
      },
    });
    assert.equal(
      newLogin.status,
      200,
      newLogin.body?.error,
    );
  } finally {
    database.close();
  }
});

test("groups, friends, invitations, expenses, settlements, and owner permissions", async () => {
  const { database, env } = createEnvironment();
  try {
    const owner = await register(
      env,
      "Owner",
      "owner@example.test",
    );
    const friend = await register(
      env,
      "Friend",
      "friend@example.test",
    );
    const invitedFriend = await register(
      env,
      "Invited Friend",
      "invited-friend@example.test",
    );
    const nonFriend = await register(
      env,
      "Non Friend",
      "non-friend@example.test",
    );

    const addFriend = await call(env, "/friends", {
      method: "POST",
      token: owner.token,
      body: { email: friend.user.email },
    });
    assert.equal(
      addFriend.status,
      201,
      addFriend.body?.error,
    );

    const createdGroup = await call(env, "/groups", {
      method: "POST",
      token: owner.token,
      body: { name: "Weekend getaway", emoji: "🏖️" },
    });
    assert.equal(
      createdGroup.status,
      201,
      createdGroup.body?.error,
    );
    const groupId = createdGroup.body.id;

    const addMember = await call(
      env,
      `/groups/${groupId}/members`,
      {
        method: "POST",
        token: owner.token,
        body: { friendIds: [friend.user.id] },
      },
    );
    assert.equal(
      addMember.status,
      201,
      addMember.body?.error,
    );

    const unverifiedInvite = await call(
      env,
      `/groups/${groupId}/invites`,
      {
        method: "POST",
        token: owner.token,
        body: { email: "pending@example.test" },
      },
    );
    assert.equal(unverifiedInvite.status, 403);
    await verifyEmail(env, owner);

    const pendingInvite = await call(
      env,
      `/groups/${groupId}/invites`,
      {
        method: "POST",
        token: owner.token,
        body: { email: "pending@example.test" },
      },
    );
    assert.equal(
      pendingInvite.status,
      201,
      pendingInvite.body?.error,
    );
    const repeatedPendingInvite = await call(
      env,
      `/groups/${groupId}/invites`,
      {
        method: "POST",
        token: owner.token,
        body: { email: "pending@example.test" },
      },
    );
    assert.equal(repeatedPendingInvite.status, 409);

    for (const [person, addToFriends] of [
      [invitedFriend, true],
      [nonFriend, false],
    ]) {
      const invite = await call(
        env,
        `/groups/${groupId}/invites`,
        {
          method: "POST",
          token: owner.token,
          body: { email: person.user.email, addToFriends },
        },
      );
      assert.equal(invite.status, 201, invite.body?.error);
      const inviteToken = new URL(
        invite.body.debugInviteUrl,
      ).searchParams.get("invite");
      assert.ok(
        inviteToken,
        "local invite exposes a copyable test link",
      );

      const pending = await call(
        env,
        `/groups/${groupId}/invites/${invite.body.id}/link`,
        { token: owner.token },
      );
      assert.equal(
        pending.status,
        200,
        pending.body?.error,
      );
      assert.match(pending.body.inviteUrl, /[?&]invite=/);

      const accepted = await call(
        env,
        `/invites/${inviteToken}/accept`,
        {
          method: "POST",
          token: person.token,
        },
      );
      assert.equal(
        accepted.status,
        200,
        accepted.body?.error,
      );
    }

    const existingMemberInvite = await call(
      env,
      `/groups/${groupId}/invites`,
      {
        method: "POST",
        token: owner.token,
        body: { email: friend.user.email },
      },
    );
    assert.equal(existingMemberInvite.status, 409);

    for (let number = 1; number <= 7; number += 1) {
      const invite = await call(
        env,
        `/groups/${groupId}/invites`,
        {
          method: "POST",
          token: owner.token,
          body: { email: `bulk-${number}@example.test` },
        },
      );
      assert.equal(invite.status, 201, invite.body?.error);
    }
    const inviteLimit = await call(
      env,
      `/groups/${groupId}/invites`,
      {
        method: "POST",
        token: owner.token,
        body: { email: "over-invite-limit@example.test" },
      },
    );
    assert.equal(inviteLimit.status, 429);

    await verifyEmail(env, friend);
    for (let number = 1; number <= 10; number += 1) {
      database
        .prepare(
          "INSERT INTO invites(group_id,email,token,invited_by,add_to_friends) VALUES(?,?,?,?,?)",
        )
        .run(
          groupId,
          "recipient-limit@example.test",
          `recipient-limit-token-${number}`,
          nonFriend.user.id,
          0,
        );
    }
    const recipientLimit = await call(
      env,
      `/groups/${groupId}/invites`,
      {
        method: "POST",
        token: friend.token,
        body: { email: "recipient-limit@example.test" },
      },
    );
    assert.equal(recipientLimit.status, 429);

    const nonOwnerEdit = await muted(() =>
      call(env, `/groups/${groupId}`, {
        method: "PUT",
        token: friend.token,
        body: { name: "Not allowed", emoji: "⛔" },
      }),
    );
    assert.equal(nonOwnerEdit.status, 403);

    const renamedGroup = await call(
      env,
      `/groups/${groupId}`,
      {
        method: "PUT",
        token: owner.token,
        body: { name: "Weekend trip", emoji: "🧳" },
      },
    );
    assert.equal(
      renamedGroup.status,
      200,
      renamedGroup.body?.error,
    );

    const participants = [
      owner.user.id,
      friend.user.id,
      invitedFriend.user.id,
      nonFriend.user.id,
    ];
    const modes = [
      ["equal", undefined],
      [
        "exact",
        splitValues(participants, ["1", "2", "3", "4"]),
      ],
      [
        "percentage",
        splitValues(participants, ["10", "20", "30", "40"]),
      ],
      [
        "shares",
        splitValues(participants, ["1", "2", "3", "4"]),
      ],
      [
        "adjustment",
        splitValues(participants, [
          "-1",
          "-0.5",
          "0.5",
          "1",
        ]),
      ],
    ];
    const expenseIds = [];
    for (const [splitMode, splits] of modes) {
      const expense = await call(
        env,
        `/groups/${groupId}/expenses`,
        {
          method: "POST",
          token: owner.token,
          body: expenseData({
            description: `${splitMode} test`,
            paidBy: owner.user.id,
            participants,
            splitMode,
            splits,
            ...(splitMode === "equal"
              ? { receiptImage: receipt }
              : {}),
          }),
        },
      );
      assert.equal(
        expense.status,
        201,
        expense.body?.error,
      );
      expenseIds.push(expense.body.id);
    }

    const invalidReceipt = await call(
      env,
      `/groups/${groupId}/expenses`,
      {
        method: "POST",
        token: owner.token,
        body: expenseData({
          description: "oversized receipt",
          paidBy: owner.user.id,
          participants,
          receiptImage: `data:image/jpeg;base64,${"A".repeat(
            4 * Math.ceil((500 * 1024 + 1) / 3),
          )}`,
        }),
      },
    );
    assert.equal(invalidReceipt.status, 400);

    const nonOwnerExpenseEdit = await muted(() =>
      call(env, `/expenses/${expenseIds[0]}`, {
        method: "PUT",
        token: friend.token,
        body: {},
      }),
    );
    assert.equal(nonOwnerExpenseEdit.status, 403);

    const ownerExpenseEdit = await call(
      env,
      `/expenses/${expenseIds[1]}`,
      {
        method: "PUT",
        token: owner.token,
        body: expenseData({
          description: "exact test updated",
          paidBy: owner.user.id,
          participants,
          splitMode: "exact",
          splits: splitValues(participants, [
            "4",
            "3",
            "2",
            "1",
          ]),
        }),
      },
    );
    assert.equal(
      ownerExpenseEdit.status,
      200,
      ownerExpenseEdit.body?.error,
    );

    const group = await call(env, `/groups/${groupId}`, {
      token: owner.token,
    });
    assert.equal(group.status, 200, group.body?.error);
    assert.equal(group.body.group.owner_name, "Owner");
    assert.equal(group.body.members.length, 4);
    const editedExpenseHistory = group.body.expenses.find(
      (expense) =>
        expense.original_expense_id === expenseIds[1] &&
        expense.history_action === "edited",
    );
    assert.ok(editedExpenseHistory);
    assert.equal(
      editedExpenseHistory.splits.reduce(
        (sum, split) => sum + split.amount_cents,
        0,
      ),
      1000,
    );
    const editedExpenseCurrent = group.body.expenses.find(
      (expense) =>
        expense.id === expenseIds[1] &&
        !expense.history_action,
    );
    assert.equal(editedExpenseHistory.amount_cents, 1000);
    assert.equal(editedExpenseCurrent.amount_cents, 1000);
    assert.notDeepEqual(
      editedExpenseHistory.splits,
      editedExpenseCurrent.splits,
    );
    assert.deepEqual(
      new Set(
        group.body.expenses.map(
          (expense) => expense.split_method,
        ),
      ),
      new Set(modes.map(([mode]) => mode)),
    );
    for (const expense of group.body.expenses)
      assert.equal(
        expense.splits.reduce(
          (sum, split) => sum + split.amount_cents,
          0,
        ),
        1000,
        `${expense.split_method} split adds up to the expense total`,
      );
    const equalExpense = group.body.expenses.find(
      (expense) => expense.id === expenseIds[0],
    );
    assert.equal(equalExpense.receipt_image, receipt);

    const createdSettlement = await call(
      env,
      `/groups/${groupId}/settlements`,
      {
        method: "POST",
        token: friend.token,
        body: {
          amount: "3.00",
          paidBy: friend.user.id,
          paidTo: owner.user.id,
          settledAt: "2026-09-21",
          receiptImage: receipt,
        },
      },
    );
    assert.equal(
      createdSettlement.status,
      201,
      createdSettlement.body?.error,
    );
    const afterSettlement = await call(
      env,
      `/groups/${groupId}`,
      {
        token: owner.token,
      },
    );
    const settlementId =
      afterSettlement.body.settlements[0].id;

    const nonOwnerSettlementEdit = await muted(() =>
      call(env, `/settlements/${settlementId}`, {
        method: "PUT",
        token: invitedFriend.token,
        body: {},
      }),
    );
    assert.equal(nonOwnerSettlementEdit.status, 403);

    const ownerSettlementEdit = await call(
      env,
      `/settlements/${settlementId}`,
      {
        method: "PUT",
        token: owner.token,
        body: {
          amount: "4.00",
          paidBy: friend.user.id,
          paidTo: owner.user.id,
          settledAt: "2026-09-21",
          receiptImage: receipt,
        },
      },
    );
    assert.equal(
      ownerSettlementEdit.status,
      200,
      ownerSettlementEdit.body?.error,
    );
    const ownerSettlementDelete = await call(
      env,
      `/settlements/${settlementId}`,
      {
        method: "DELETE",
        token: owner.token,
      },
    );
    assert.equal(ownerSettlementDelete.status, 204);
    const afterSettlementDelete = await call(
      env,
      `/groups/${groupId}`,
      {
        token: owner.token,
      },
    );
    assert.equal(
      afterSettlementDelete.status,
      200,
      afterSettlementDelete.body?.error,
    );
    assert.ok(
      afterSettlementDelete.body.settlements.some(
        (settlement) =>
          settlement.original_settlement_id ===
            settlementId &&
          settlement.history_action === "edited",
      ),
    );
    const editedSettlementHistory =
      afterSettlementDelete.body.settlements.find(
        (settlement) =>
          settlement.original_settlement_id ===
            settlementId &&
          settlement.history_action === "edited",
      );
    const deletedSettlementHistory =
      afterSettlementDelete.body.settlements.find(
        (settlement) =>
          settlement.original_settlement_id ===
            settlementId &&
          settlement.history_action === "deleted",
      );
    assert.equal(editedSettlementHistory.amount_cents, 300);
    assert.equal(
      deletedSettlementHistory.amount_cents,
      400,
    );
    assert.ok(
      afterSettlementDelete.body.settlements.some(
        (settlement) =>
          settlement.original_settlement_id ===
            settlementId &&
          settlement.history_action === "deleted",
      ),
    );

    const firstPage = await call(
      env,
      "/dashboard?activityPage=1&activityPageSize=2",
      { token: owner.token },
    );
    assert.equal(
      firstPage.status,
      200,
      firstPage.body?.error,
    );
    assert.equal(firstPage.body.activity.length, 2);
    assert.equal(
      firstPage.body.activityPagination.total,
      5,
    );
    assert.equal(
      firstPage.body.activityPagination.totalPages,
      3,
    );
    const dashboardGroup = firstPage.body.groups.find(
      (group) => group.id === groupId,
    );
    assert.equal(dashboardGroup.balance_cents, 4000);
    assert.deepEqual(dashboardGroup.balances, [
      { id: owner.user.id, balance_cents: 4000 },
    ]);
    assert.ok(
      firstPage.body.friends.some(
        (person) => person.id === friend.user.id,
      ),
    );
    assert.ok(
      firstPage.body.friends.some(
        (person) => person.id === invitedFriend.user.id,
      ),
    );
    assert.ok(
      firstPage.body.unsettled_non_friends.some(
        (person) => person.id === nonFriend.user.id,
      ),
    );
    const lastPage = await call(
      env,
      "/dashboard?activityPage=3&activityPageSize=2",
      { token: owner.token },
    );
    assert.equal(
      lastPage.status,
      200,
      lastPage.body?.error,
    );
    assert.equal(lastPage.body.activity.length, 1);

    const unfriend = await call(
      env,
      `/friends/${friend.user.id}`,
      {
        method: "DELETE",
        token: owner.token,
      },
    );
    assert.equal(
      unfriend.status,
      200,
      unfriend.body?.error,
    );

    const nonOwnerExpenseDelete = await muted(() =>
      call(env, `/expenses/${expenseIds[2]}`, {
        method: "DELETE",
        token: friend.token,
      }),
    );
    assert.equal(nonOwnerExpenseDelete.status, 403);
    const ownerExpenseDelete = await call(
      env,
      `/expenses/${expenseIds[2]}`,
      {
        method: "DELETE",
        token: owner.token,
      },
    );
    assert.equal(ownerExpenseDelete.status, 204);
    const afterExpenseDelete = await call(
      env,
      `/groups/${groupId}`,
      {
        token: owner.token,
      },
    );
    assert.equal(
      afterExpenseDelete.status,
      200,
      afterExpenseDelete.body?.error,
    );
    assert.ok(
      afterExpenseDelete.body.expenses.some(
        (expense) =>
          expense.original_expense_id === expenseIds[2] &&
          expense.history_action === "deleted",
      ),
    );
    assert.equal(
      afterExpenseDelete.body.expenses.find(
        (expense) =>
          expense.id === expenseIds[2] &&
          !expense.history_action,
      ),
      undefined,
    );

    const deleteGroup = await call(
      env,
      `/groups/${groupId}`,
      {
        method: "DELETE",
        token: owner.token,
      },
    );
    assert.equal(deleteGroup.status, 204);
    const deletedGroup = await muted(() =>
      call(env, `/groups/${groupId}`, {
        token: owner.token,
      }),
    );
    assert.equal(deletedGroup.status, 404);

    for (const name of ["Second group", "Third group"]) {
      const created = await call(env, "/groups", {
        method: "POST",
        token: owner.token,
        body: { name, emoji: "*" },
      });
      assert.equal(
        created.status,
        201,
        created.body?.error,
      );
    }
    const groupLimit = await call(env, "/groups", {
      method: "POST",
      token: owner.token,
      body: { name: "Fourth group", emoji: "*" },
    });
    assert.equal(groupLimit.status, 429);
  } finally {
    database.close();
  }
});

test("random tips use cached quotes and client assets include the main controls", async () => {
  const { database, env } = createEnvironment();
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  try {
    const account = await register(
      env,
      "Tip user",
      "tip@example.test",
    );
    let cachedResponse;
    globalThis.caches = {
      default: {
        async match() {
          return cachedResponse?.clone();
        },
        async put(_key, response) {
          cachedResponse = response.clone();
        },
      },
    };
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            q: "A small test makes a big difference.",
            a: "Splito",
          },
        ]),
        { status: 200 },
      );
    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
      const tip = await call(env, "/tip", {
        token: account.token,
      });
      assert.equal(tip.status, 200, tip.body?.error);
      assert.deepEqual(tip.body.tip, {
        quote: "A small test makes a big difference.",
        author: "Splito",
        source: "zenquotes",
      });
      assert.ok(
        cachedResponse,
        "quote response is cached for later reloads",
      );
    } finally {
      Math.random = originalRandom;
    }

    const app = readFileSync(
      join(projectRoot, "app.js"),
      "utf8",
    );
    const html = readFileSync(
      join(projectRoot, "index.html"),
      "utf8",
    );
    for (const feature of [
      "activityPagination",
      "unsettled_non_friends",
      "receiptImage",
      "avatarColor",
      "splitModeDetails",
      'api("/tip")',
      "Copy link",
      "auth-pending",
      "showSignedInApp",
      "verifyEmailFromUrl",
      "resendVerificationBtn",
      "pairedHistoryEntries",
      "current-version-status",
      "has-history-pair",
    ])
      assert.ok(
        app.includes(feature) || html.includes(feature),
        `client control is present: ${feature}`,
      );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined)
      delete globalThis.caches;
    else globalThis.caches = originalCaches;
    database.close();
  }
});
