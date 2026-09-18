const encoder = new TextEncoder(),
  decoder = new TextDecoder();
const id = (value) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : NaN;
};

function cors(request, env) {
  const configuredOrigin = env.FRONTEND_URL
    ? new URL(env.FRONTEND_URL).origin
    : null;
  return {
    "access-control-allow-origin":
      configuredOrigin ||
      request.headers.get("Origin") ||
      "*",
    "access-control-allow-headers":
      "authorization, content-type",
    "access-control-allow-methods":
      "GET, POST, PUT, DELETE, OPTIONS",
    vary: "Origin",
  };
}
function json(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...cors(request, env),
    },
  });
}
function encode(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
function decode(value) {
  return Uint8Array.from(
    atob(
      value.replaceAll("-", "+").replaceAll("_", "/") +
        "=".repeat((4 - (value.length % 4)) % 4),
    ),
    (char) => char.charCodeAt(0),
  );
}
async function passwordHash(
  password,
  salt = crypto.randomUUID(),
) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return `${salt}:${encode(bits)}`;
}
async function tokenHash(token) {
  return encode(
    await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(token),
    ),
  );
}
function createResetToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encode(bytes);
}
function isLocalFrontend(env) {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(
    env.FRONTEND_URL || "",
  );
}
function escapeEmailHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character],
  );
}
async function sendPasswordResetEmail(
  env,
  email,
  resetUrl,
) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) return false;
  const response = await fetch(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM,
        to: [email],
        subject: "Reset your Splito password",
        html: `<p>We received a request to reset your Splito password.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in one hour and can be used once. If you did not request it, you can ignore this email.</p>`,
      }),
    },
  );
  if (!response.ok) {
    console.error("Password-reset email delivery failed.");
  }
  return response.ok;
}
async function sendGroupInviteEmail(
  env,
  email,
  inviteUrl,
  groupName,
  inviterName,
) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) return false;
  const response = await fetch(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM,
        to: [email],
        subject: `${groupName} invited you to join Splito`,
        html: `<p>${escapeEmailHtml(inviterName)} invited you to join <strong>${escapeEmailHtml(groupName)}</strong> on Splito.</p><p><a href="${inviteUrl}">Join this group</a></p><p>Sign in or create an account with this email address to accept the invitation.</p>`,
      }),
    },
  );
  if (!response.ok) {
    console.error("Group-invite email delivery failed.");
  }
  return response.ok;
}
async function signToken(user, secret) {
  const header = encode(
    encoder.encode(
      JSON.stringify({ alg: "HS256", typ: "JWT" }),
    ),
  );
  const payload = encode(
    encoder.encode(
      JSON.stringify({
        ...user,
        ver: user.auth_version || 0,
        exp: Date.now() + 2592000000,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return `${header}.${payload}.${encode(await crypto.subtle.sign("HMAC", key, encoder.encode(`${header}.${payload}`)))}`;
}
async function currentUser(request, env) {
  const token = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (!token || !env.JWT_SECRET) return null;
  const [header, payload, signature] = token.split(".");
  if (!signature) return null;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(env.JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        key,
        decode(signature),
        encoder.encode(`${header}.${payload}`),
      ))
    )
      return null;
    const user = JSON.parse(
      decoder.decode(decode(payload)),
    );
    return user.exp > Date.now() ? user : null;
  } catch {
    return null;
  }
}
async function member(db, groupId, userId) {
  return Boolean(
    await db
      .prepare(
        "SELECT 1 FROM group_members WHERE group_id=? AND user_id=?",
      )
      .bind(groupId, userId)
      .first(),
  );
}
async function friends(db, userId) {
  const rows = await db
    .prepare(
      "SELECT u.id,u.name,u.email,f.created_at,(SELECT COUNT(*) FROM group_members mine JOIN group_members theirs ON mine.group_id=theirs.group_id WHERE mine.user_id=? AND theirs.user_id=u.id) AS shared_group_count FROM friendships f JOIN users u ON u.id=CASE WHEN f.user_id=? THEN f.friend_id ELSE f.user_id END WHERE f.user_id=? OR f.friend_id=? ORDER BY u.name COLLATE NOCASE",
    )
    .bind(userId, userId, userId, userId)
    .all();
  return rows.results;
}
function friendshipPair(firstUserId, secondUserId) {
  return firstUserId < secondUserId
    ? [firstUserId, secondUserId]
    : [secondUserId, firstUserId];
}
async function addFriendship(
  db,
  firstUserId,
  secondUserId,
) {
  if (firstUserId === secondUserId) return false;
  const [userId, friendId] = friendshipPair(
    firstUserId,
    secondUserId,
  );
  const result = await db
    .prepare(
      "INSERT OR IGNORE INTO friendships(user_id,friend_id) VALUES(?,?)",
    )
    .bind(userId, friendId)
    .run();
  return result.meta.changes === 1;
}
async function balances(db, groupId) {
  const people = await db
    .prepare(
      "SELECT u.id,u.name,u.email FROM users u JOIN group_members gm ON gm.user_id=u.id WHERE gm.group_id=?",
    )
    .bind(groupId)
    .all();
  const result = new Map(
    people.results.map((person) => [
      person.id,
      { ...person, balance_cents: 0 },
    ]),
  );
  const expenses = await db
    .prepare(
      "SELECT paid_by,amount_cents FROM expenses WHERE group_id=?",
    )
    .bind(groupId)
    .all();
  for (const row of expenses.results) {
    result.get(row.paid_by).balance_cents +=
      row.amount_cents;
  }
  const splits = await db
    .prepare(
      "SELECT s.user_id,s.amount_cents AS split_cents FROM expense_splits s JOIN expenses e ON e.id=s.expense_id WHERE e.group_id=?",
    )
    .bind(groupId)
    .all();
  for (const row of splits.results) {
    result.get(row.user_id).balance_cents -=
      row.split_cents;
  }
  const settlements = await db
    .prepare(
      "SELECT paid_by,paid_to,amount_cents FROM settlements WHERE group_id=?",
    )
    .bind(groupId)
    .all();
  for (const row of settlements.results) {
    result.get(row.paid_by).balance_cents +=
      row.amount_cents;
    result.get(row.paid_to).balance_cents -=
      row.amount_cents;
  }
  return [...result.values()];
}
async function ensureGroup(db, groupId, userId) {
  if (
    !Number.isInteger(groupId) ||
    !(await member(db, groupId, userId))
  )
    throw new Error("GROUP_NOT_FOUND");
}
function validDate(value, fallback) {
  const date = value || fallback;
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}
async function expenseInput(db, groupId, data) {
  const cents = Math.round(Number(data.amount) * 100),
    paidBy = id(data.paidBy),
    participants = [
      ...new Set((data.participants || []).map(id)),
    ],
    date = validDate(
      data.date,
      new Date().toISOString().slice(0, 10),
    ),
    category = String(data.category || "other")
      .trim()
      .slice(0, 32),
    notes =
      String(data.notes || "")
        .trim()
        .slice(0, 1000) || null;
  if (
    !data.description?.trim() ||
    !Number.isSafeInteger(cents) ||
    cents < 1 ||
    !date
  )
    return {
      error: "Add a description, valid amount, and date.",
    };
  if (
    !Number.isSafeInteger(paidBy) ||
    !participants.length ||
    participants.some(
      (person) => !Number.isSafeInteger(person),
    ) ||
    !(await member(db, groupId, paidBy)) ||
    (
      await Promise.all(
        participants.map((person) =>
          member(db, groupId, person),
        ),
      )
    ).includes(false)
  )
    return {
      error: "Choose valid group members and payer.",
    };
  return {
    expense: {
      description: data.description.trim().slice(0, 200),
      cents,
      paidBy,
      category: category || "other",
      date,
      notes,
    },
    participants,
  };
}
function splitStatements(
  db,
  expenseId,
  cents,
  participants,
) {
  const each = Math.floor(cents / participants.length),
    remainder = cents % participants.length;
  return participants.map((person, index) =>
    db
      .prepare(
        "INSERT INTO expense_splits(expense_id,user_id,amount_cents) VALUES(?,?,?)",
      )
      .bind(
        expenseId,
        person,
        each + (index < remainder ? 1 : 0),
      ),
  );
}
async function settlementInput(
  db,
  groupId,
  data,
  defaultPayer,
) {
  const cents = Math.round(Number(data.amount) * 100),
    paidBy = id(data.paidBy || defaultPayer),
    paidTo = id(data.paidTo),
    settledAt = validDate(
      data.settledAt,
      new Date().toISOString().slice(0, 10),
    );
  if (
    !Number.isSafeInteger(cents) ||
    cents < 1 ||
    !Number.isSafeInteger(paidBy) ||
    !Number.isSafeInteger(paidTo) ||
    paidBy === paidTo ||
    !settledAt ||
    !(await member(db, groupId, paidBy)) ||
    !(await member(db, groupId, paidTo))
  )
    return {
      error:
        "Choose different group members, a valid amount, and date.",
    };
  return {
    settlement: { cents, paidBy, paidTo, settledAt },
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS")
      return new Response(null, {
        headers: cors(request, env),
      });
    const path = new URL(request.url).pathname.replace(
        /^\/api/,
        "",
      ),
      parts = path.split("/").filter(Boolean),
      db = env.DB;
    try {
      if (!db || !env.JWT_SECRET)
        throw new Error(
          "Worker is missing DB or JWT_SECRET configuration.",
        );
      if (
        request.method === "POST" &&
        path === "/auth/register"
      ) {
        const { name, email, password } =
          await request.json();
        if (
          !name?.trim() ||
          !email?.includes("@") ||
          !password ||
          password.length < 6
        )
          return json(
            request,
            env,
            {
              error:
                "Enter a name, valid email, and password of at least 6 characters.",
            },
            400,
          );
        const user = {
          id: (
            await db
              .prepare(
                "INSERT INTO users(name,email,password_hash) VALUES(?,?,?)",
              )
              .bind(
                name.trim(),
                email.toLowerCase().trim(),
                await passwordHash(password),
              )
              .run()
          ).meta.last_row_id,
          name: name.trim(),
          email: email.toLowerCase().trim(),
        };
        return json(
          request,
          env,
          {
            user,
            token: await signToken(user, env.JWT_SECRET),
          },
          201,
        );
      }
      if (
        request.method === "POST" &&
        path === "/auth/login"
      ) {
        const { email, password } = await request.json(),
          row = await db
            .prepare("SELECT * FROM users WHERE email=?")
            .bind(email?.toLowerCase().trim())
            .first();
        if (
          !row ||
          (await passwordHash(
            password || "",
            row.password_hash.split(":")[0],
          )) !== row.password_hash
        )
          return json(
            request,
            env,
            { error: "Incorrect email or password." },
            401,
          );
        const user = {
          id: row.id,
          name: row.name,
          email: row.email,
          auth_version: row.auth_version || 0,
        };
        return json(request, env, {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
          },
          token: await signToken(user, env.JWT_SECRET),
        });
      }
      if (
        request.method === "POST" &&
        path === "/auth/forgot-password"
      ) {
        const { email } = await request.json(),
          cleanEmail = email?.toLowerCase().trim(),
          message =
            "If an account matches that email, a reset link has been sent.";
        if (!cleanEmail?.includes("@"))
          return json(request, env, { message });
        const account = await db
          .prepare(
            "SELECT id,email FROM users WHERE email=?",
          )
          .bind(cleanEmail)
          .first();
        if (!account)
          return json(request, env, { message });
        const token = createResetToken(),
          resetUrl = `${(env.FRONTEND_URL || new URL(request.url).origin).replace(/\/$/, "")}/?reset=${encodeURIComponent(token)}`;
        await db.batch([
          db
            .prepare(
              "DELETE FROM password_reset_tokens WHERE user_id=?",
            )
            .bind(account.id),
          db
            .prepare(
              "INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES(?,?,?)",
            )
            .bind(
              account.id,
              await tokenHash(token),
              Date.now() + 60 * 60 * 1000,
            ),
        ]);
        try {
          await sendPasswordResetEmail(
            env,
            account.email,
            resetUrl,
          );
        } catch {
          console.error(
            "Password-reset email delivery failed.",
          );
        }
        return json(request, env, {
          message,
          ...(isLocalFrontend(env)
            ? { debugResetUrl: resetUrl }
            : {}),
        });
      }
      if (
        request.method === "POST" &&
        path === "/auth/reset-password"
      ) {
        const { token, newPassword } = await request.json();
        if (
          !token ||
          !newPassword ||
          newPassword.length < 6
        )
          return json(
            request,
            env,
            {
              error:
                "Enter a valid reset link and a password of at least 6 characters.",
            },
            400,
          );
        const hashedToken = await tokenHash(token),
          reset = await db
            .prepare(
              "SELECT id,user_id FROM password_reset_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
            )
            .bind(hashedToken, Date.now())
            .first();
        if (!reset)
          return json(
            request,
            env,
            {
              error:
                "This reset link is invalid or has expired.",
            },
            400,
          );
        const claim = await db
          .prepare(
            "UPDATE password_reset_tokens SET used_at=CURRENT_TIMESTAMP WHERE id=? AND used_at IS NULL AND expires_at>?",
          )
          .bind(reset.id, Date.now())
          .run();
        if (claim.meta.changes !== 1)
          return json(
            request,
            env,
            {
              error:
                "This reset link is invalid or has expired.",
            },
            400,
          );
        await db
          .prepare(
            "UPDATE users SET password_hash=?,auth_version=auth_version+1 WHERE id=?",
          )
          .bind(
            await passwordHash(newPassword),
            reset.user_id,
          )
          .run();
        return json(request, env, {
          message: "Password reset. You can now sign in.",
        });
      }
      const tokenUser = await currentUser(request, env);
      if (!tokenUser)
        return json(
          request,
          env,
          { error: "Please sign in." },
          401,
        );
      const user = await db
        .prepare(
          "SELECT id,name,email,auth_version FROM users WHERE id=?",
        )
        .bind(tokenUser.id)
        .first();
      if (
        !user ||
        user.auth_version !== (tokenUser.ver || 0)
      )
        return json(
          request,
          env,
          { error: "Please sign in." },
          401,
        );
      if (request.method === "GET" && path === "/me")
        return json(request, env, {
          user: await db
            .prepare(
              "SELECT id,name,email FROM users WHERE id=?",
            )
            .bind(user.id)
            .first(),
        });
      if (request.method === "PUT" && path === "/me") {
        const data = await request.json(),
          current = await db
            .prepare("SELECT * FROM users WHERE id=?")
            .bind(user.id)
            .first(),
          name = data.name?.trim().slice(0, 100),
          email = data.email?.toLowerCase().trim(),
          currentPassword = data.currentPassword || "",
          newPassword = data.newPassword || "";
        if (!current)
          return json(
            request,
            env,
            { error: "Account not found." },
            404,
          );
        if (!name || !email?.includes("@"))
          return json(
            request,
            env,
            {
              error:
                "Enter a name and valid email address.",
            },
            400,
          );
        if (newPassword && newPassword.length < 6)
          return json(
            request,
            env,
            {
              error:
                "New passwords must be at least 6 characters.",
            },
            400,
          );
        const protectedChange =
          email !== current.email || Boolean(newPassword);
        if (
          protectedChange &&
          (!currentPassword ||
            (await passwordHash(
              currentPassword,
              current.password_hash.split(":")[0],
            )) !== current.password_hash)
        )
          return json(
            request,
            env,
            {
              error:
                "Enter your current password to change your email or password.",
            },
            401,
          );
        const updatedUser = {
          id: current.id,
          name,
          email,
          auth_version:
            current.auth_version +
            (protectedChange ? 1 : 0),
        };
        await db
          .prepare(
            "UPDATE users SET name=?,email=?,password_hash=?,auth_version=auth_version+? WHERE id=?",
          )
          .bind(
            name,
            email,
            newPassword
              ? await passwordHash(newPassword)
              : current.password_hash,
            protectedChange ? 1 : 0,
            current.id,
          )
          .run();
        return json(request, env, {
          user: {
            id: updatedUser.id,
            name: updatedUser.name,
            email: updatedUser.email,
          },
          token: await signToken(
            updatedUser,
            env.JWT_SECRET,
          ),
        });
      }
      if (
        request.method === "GET" &&
        path === "/dashboard"
      ) {
        const groups = await db
          .prepare(
            "SELECT g.*,(SELECT COUNT(*) FROM group_members gm WHERE gm.group_id=g.id) member_count FROM groups g JOIN group_members mine ON mine.group_id=g.id WHERE mine.user_id=? ORDER BY g.created_at DESC",
          )
          .bind(user.id)
          .all();
        for (const group of groups.results)
          group.balances = await balances(db, group.id);
        const activity = await db
          .prepare(
            "SELECT e.id,e.group_id,e.description,e.amount_cents,e.category,e.expense_date AS activity_date,e.created_at,g.name AS group_name,u.name AS payer_name,'expense' AS entry_type FROM expenses e JOIN groups g ON g.id=e.group_id JOIN users u ON u.id=e.paid_by JOIN group_members mine ON mine.group_id=g.id AND mine.user_id=? UNION ALL SELECT s.id,s.group_id,'Settlement' AS description,s.amount_cents,'settlement' AS category,substr(s.settled_at,1,10) AS activity_date,s.settled_at AS created_at,g.name AS group_name,a.name || ' paid ' || b.name AS payer_name,'settlement' AS entry_type FROM settlements s JOIN groups g ON g.id=s.group_id JOIN users a ON a.id=s.paid_by JOIN users b ON b.id=s.paid_to JOIN group_members mine ON mine.group_id=g.id AND mine.user_id=? ORDER BY created_at DESC LIMIT 20",
          )
          .bind(user.id, user.id)
          .all();
        return json(request, env, {
          groups: groups.results,
          activity: activity.results,
          friends: await friends(db, user.id),
        });
      }
      if (
        request.method === "POST" &&
        path === "/friends"
      ) {
        const { email } = await request.json();
        const cleanEmail = email?.toLowerCase().trim();
        if (!cleanEmail?.includes("@"))
          return json(
            request,
            env,
            { error: "Enter a valid email address." },
            400,
          );
        const friend = await db
          .prepare(
            "SELECT id,name,email FROM users WHERE email=?",
          )
          .bind(cleanEmail)
          .first();
        if (!friend)
          return json(
            request,
            env,
            {
              error:
                "No Splito account uses that email. Invite them to a group first.",
            },
            404,
          );
        if (friend.id === user.id)
          return json(
            request,
            env,
            {
              error: "You cannot add yourself as a friend.",
            },
            400,
          );
        if (!(await addFriendship(db, user.id, friend.id)))
          return json(
            request,
            env,
            {
              error:
                "That person is already in your Friends list.",
            },
            409,
          );
        return json(request, env, { friend }, 201);
      }
      if (
        parts[0] === "friends" &&
        parts.length === 2 &&
        request.method === "DELETE"
      ) {
        const friendId = id(parts[1]);
        if (
          !Number.isSafeInteger(friendId) ||
          friendId === user.id
        )
          return json(
            request,
            env,
            { error: "Choose a valid friend." },
            400,
          );
        const [firstUserId, secondUserId] = friendshipPair(
          user.id,
          friendId,
        );
        const result = await db
          .prepare(
            "DELETE FROM friendships WHERE user_id=? AND friend_id=?",
          )
          .bind(firstUserId, secondUserId)
          .run();
        if (result.meta.changes !== 1)
          return json(
            request,
            env,
            {
              error:
                "That person is not in your Friends list.",
            },
            404,
          );
        return json(request, env, { removedId: friendId });
      }
      if (request.method === "POST" && path === "/groups") {
        const { name, emoji = "✦" } = await request.json();
        if (!name?.trim())
          return json(
            request,
            env,
            { error: "A group name is required." },
            400,
          );
        const groupId = (
          await db
            .prepare(
              "INSERT INTO groups(name,emoji,created_by) VALUES(?,?,?)",
            )
            .bind(name.trim(), emoji.slice(0, 4), user.id)
            .run()
        ).meta.last_row_id;
        await db
          .prepare(
            "INSERT INTO group_members(group_id,user_id) VALUES(?,?)",
          )
          .bind(groupId, user.id)
          .run();
        return json(request, env, { id: groupId }, 201);
      }
      if (
        parts[0] === "groups" &&
        parts.length === 2 &&
        request.method === "PUT"
      ) {
        const groupId = id(parts[1]);
        await ensureGroup(db, groupId, user.id);
        const { name, emoji = "*" } = await request.json();
        if (!name?.trim())
          return json(
            request,
            env,
            { error: "A group name is required." },
            400,
          );
        await db
          .prepare(
            "UPDATE groups SET name=?,emoji=? WHERE id=?",
          )
          .bind(
            name.trim().slice(0, 100),
            String(emoji).slice(0, 4),
            groupId,
          )
          .run();
        return json(request, env, { id: groupId });
      }
      if (
        parts[0] === "groups" &&
        parts.length === 2 &&
        request.method === "GET"
      ) {
        const groupId = id(parts[1]);
        await ensureGroup(db, groupId, user.id);
        const group = await db
            .prepare("SELECT * FROM groups WHERE id=?")
            .bind(groupId)
            .first(),
          members = await db
            .prepare(
              "SELECT u.id,u.name,u.email FROM users u JOIN group_members gm ON gm.user_id=u.id WHERE gm.group_id=?",
            )
            .bind(groupId)
            .all(),
          expenses = await db
            .prepare(
              "SELECT e.*,u.name payer_name FROM expenses e JOIN users u ON u.id=e.paid_by WHERE e.group_id=? ORDER BY e.expense_date DESC,e.created_at DESC",
            )
            .bind(groupId)
            .all(),
          settlements = await db
            .prepare(
              "SELECT s.*,a.name payer_name,b.name payee_name FROM settlements s JOIN users a ON a.id=s.paid_by JOIN users b ON b.id=s.paid_to WHERE s.group_id=? ORDER BY s.settled_at DESC",
            )
            .bind(groupId)
            .all(),
          invites = await db
            .prepare(
              "SELECT id,email,created_at,accepted_at,add_to_friends FROM invites WHERE group_id=? ORDER BY CASE WHEN accepted_at IS NULL THEN 0 ELSE 1 END,created_at DESC",
            )
            .bind(groupId)
            .all();
        for (const expense of expenses.results)
          expense.splits = (
            await db
              .prepare(
                "SELECT s.*,u.name FROM expense_splits s JOIN users u ON u.id=s.user_id WHERE expense_id=?",
              )
              .bind(expense.id)
              .all()
          ).results;
        return json(request, env, {
          group,
          members: members.results,
          expenses: expenses.results,
          settlements: settlements.results,
          invites: invites.results,
          balances: await balances(db, groupId),
        });
      }
      if (
        parts[0] === "groups" &&
        parts[2] === "members" &&
        request.method === "POST"
      ) {
        const groupId = id(parts[1]);
        await ensureGroup(db, groupId, user.id);
        const { friendIds = [] } = await request.json();
        const selectedIds = [...new Set(friendIds.map(id))];
        if (
          !selectedIds.length ||
          selectedIds.some(
            (friendId) => !Number.isSafeInteger(friendId),
          )
        )
          return json(
            request,
            env,
            { error: "Choose at least one friend." },
            400,
          );
        const availableFriends = await friends(db, user.id);
        const friendById = new Map(
          availableFriends.map((friend) => [
            friend.id,
            friend,
          ]),
        );
        if (
          selectedIds.some(
            (friendId) => !friendById.has(friendId),
          )
        )
          return json(
            request,
            env,
            {
              error:
                "You can only add people from your Friends list.",
            },
            403,
          );
        const newMembers = [];
        for (const friendId of selectedIds) {
          if (!(await member(db, groupId, friendId)))
            newMembers.push(friendById.get(friendId));
        }
        if (!newMembers.length)
          return json(
            request,
            env,
            {
              error:
                "The selected friends are already members of this group.",
            },
            409,
          );
        await db.batch(
          newMembers.map((friend) =>
            db
              .prepare(
                "INSERT INTO group_members(group_id,user_id) VALUES(?,?)",
              )
              .bind(groupId, friend.id),
          ),
        );
        return json(
          request,
          env,
          { members: newMembers },
          201,
        );
      }
      if (
        parts[0] === "groups" &&
        parts[2] === "invites" &&
        request.method === "POST"
      ) {
        const groupId = id(parts[1]);
        await ensureGroup(db, groupId, user.id);
        const { email, addToFriends = false } =
            await request.json(),
          cleanEmail = email?.toLowerCase().trim();
        if (!cleanEmail?.includes("@"))
          return json(
            request,
            env,
            { error: "Enter a valid email." },
            400,
          );
        const group = await db
          .prepare("SELECT name FROM groups WHERE id=?")
          .bind(groupId)
          .first();
        const invite = crypto.randomUUID();
        const created = await db
          .prepare(
            "INSERT INTO invites(group_id,email,token,invited_by,add_to_friends) VALUES(?,?,?,?,?)",
          )
          .bind(
            groupId,
            cleanEmail,
            invite,
            user.id,
            addToFriends ? 1 : 0,
          )
          .run();
        const inviteUrl = `${env.FRONTEND_URL || new URL(request.url).origin}/?invite=${invite}`;
        const emailSent = await sendGroupInviteEmail(
          env,
          cleanEmail,
          inviteUrl,
          group.name,
          user.name,
        );
        if (!emailSent && !isLocalFrontend(env)) {
          await db
            .prepare("DELETE FROM invites WHERE id=?")
            .bind(created.meta.last_row_id)
            .run();
          return json(
            request,
            env,
            {
              error:
                "The invitation email could not be sent. Check RESEND_API_KEY and RESEND_FROM, then try again.",
            },
            503,
          );
        }
        return json(
          request,
          env,
          {
            id: created.meta.last_row_id,
            email: cleanEmail,
            status: "pending",
            ...(emailSent
              ? {}
              : { debugInviteUrl: inviteUrl }),
          },
          201,
        );
      }
      if (
        parts[0] === "invites" &&
        parts[2] === "accept" &&
        request.method === "POST"
      ) {
        const invite = await db
          .prepare(
            "SELECT * FROM invites WHERE token=? AND accepted_at IS NULL",
          )
          .bind(parts[1])
          .first();
        if (!invite)
          return json(
            request,
            env,
            {
              error:
                "This invite is invalid or already used.",
            },
            404,
          );
        if (invite.email !== user.email)
          return json(
            request,
            env,
            {
              error:
                "Sign in with the email that received this invitation.",
            },
            403,
          );
        const statements = [
          db
            .prepare(
              "INSERT OR IGNORE INTO group_members(group_id,user_id) VALUES(?,?)",
            )
            .bind(invite.group_id, user.id),
          db
            .prepare(
              "UPDATE invites SET accepted_at=CURRENT_TIMESTAMP WHERE id=?",
            )
            .bind(invite.id),
        ];
        if (
          invite.add_to_friends &&
          invite.invited_by !== user.id
        )
          statements.push(
            db
              .prepare(
                "INSERT OR IGNORE INTO friendships(user_id,friend_id) VALUES(?,?)",
              )
              .bind(
                ...friendshipPair(
                  invite.invited_by,
                  user.id,
                ),
              ),
          );
        await db.batch(statements);
        return json(request, env, {
          groupId: invite.group_id,
        });
      }
      if (
        parts[0] === "groups" &&
        parts[2] === "expenses" &&
        request.method === "POST"
      ) {
        const groupId = id(parts[1]);
        await ensureGroup(db, groupId, user.id);
        const input = await expenseInput(
          db,
          groupId,
          await request.json(),
        );
        if (input.error)
          return json(
            request,
            env,
            { error: input.error },
            400,
          );
        const { expense, participants } = input;
        const expenseId = (
          await db
            .prepare(
              "INSERT INTO expenses(group_id,description,amount_cents,paid_by,category,expense_date,notes) VALUES(?,?,?,?,?,?,?)",
            )
            .bind(
              groupId,
              expense.description,
              expense.cents,
              expense.paidBy,
              expense.category,
              expense.date,
              expense.notes,
            )
            .run()
        ).meta.last_row_id;
        await db.batch(
          splitStatements(
            db,
            expenseId,
            expense.cents,
            participants,
          ),
        );
        return json(request, env, { id: expenseId }, 201);
      }
      if (
        parts[0] === "expenses" &&
        parts.length === 2 &&
        request.method === "PUT"
      ) {
        const expenseId = id(parts[1]);
        const existing = await db
          .prepare("SELECT * FROM expenses WHERE id=?")
          .bind(expenseId)
          .first();
        if (
          !existing ||
          !(await member(db, existing.group_id, user.id))
        )
          return json(
            request,
            env,
            { error: "Expense not found." },
            404,
          );
        const input = await expenseInput(
          db,
          existing.group_id,
          await request.json(),
        );
        if (input.error)
          return json(
            request,
            env,
            { error: input.error },
            400,
          );
        const { expense, participants } = input;
        await db.batch([
          db
            .prepare(
              "UPDATE expenses SET description=?,amount_cents=?,paid_by=?,category=?,expense_date=?,notes=? WHERE id=?",
            )
            .bind(
              expense.description,
              expense.cents,
              expense.paidBy,
              expense.category,
              expense.date,
              expense.notes,
              expenseId,
            ),
          db
            .prepare(
              "DELETE FROM expense_splits WHERE expense_id=?",
            )
            .bind(expenseId),
          ...splitStatements(
            db,
            expenseId,
            expense.cents,
            participants,
          ),
        ]);
        return json(request, env, { id: expenseId });
      }
      if (
        parts[0] === "expenses" &&
        request.method === "DELETE"
      ) {
        const expense = await db
          .prepare("SELECT * FROM expenses WHERE id=?")
          .bind(id(parts[1]))
          .first();
        if (
          !expense ||
          !(await member(db, expense.group_id, user.id))
        )
          return json(
            request,
            env,
            { error: "Expense not found." },
            404,
          );
        await db
          .prepare("DELETE FROM expenses WHERE id=?")
          .bind(expense.id)
          .run();
        return new Response(null, {
          status: 204,
          headers: cors(request, env),
        });
      }
      if (
        parts[0] === "groups" &&
        parts[2] === "settlements" &&
        request.method === "POST"
      ) {
        const groupId = id(parts[1]);
        await ensureGroup(db, groupId, user.id);
        const input = await settlementInput(
          db,
          groupId,
          await request.json(),
          user.id,
        );
        if (input.error)
          return json(
            request,
            env,
            { error: input.error },
            400,
          );
        const { settlement } = input;
        await db
          .prepare(
            "INSERT INTO settlements(group_id,paid_by,paid_to,amount_cents,settled_at) VALUES(?,?,?,?,?)",
          )
          .bind(
            groupId,
            settlement.paidBy,
            settlement.paidTo,
            settlement.cents,
            settlement.settledAt,
          )
          .run();
        return json(request, env, { ok: true }, 201);
      }
      if (
        parts[0] === "settlements" &&
        parts.length === 2 &&
        request.method === "PUT"
      ) {
        const settlementId = id(parts[1]);
        const existing = await db
          .prepare("SELECT * FROM settlements WHERE id=?")
          .bind(settlementId)
          .first();
        if (
          !existing ||
          !(await member(db, existing.group_id, user.id))
        )
          return json(
            request,
            env,
            { error: "Settlement not found." },
            404,
          );
        const input = await settlementInput(
          db,
          existing.group_id,
          await request.json(),
          existing.paid_by,
        );
        if (input.error)
          return json(
            request,
            env,
            { error: input.error },
            400,
          );
        const { settlement } = input;
        await db
          .prepare(
            "UPDATE settlements SET paid_by=?,paid_to=?,amount_cents=?,settled_at=? WHERE id=?",
          )
          .bind(
            settlement.paidBy,
            settlement.paidTo,
            settlement.cents,
            settlement.settledAt,
            settlementId,
          )
          .run();
        return json(request, env, { id: settlementId });
      }
      if (
        parts[0] === "settlements" &&
        parts.length === 2 &&
        request.method === "DELETE"
      ) {
        const settlement = await db
          .prepare("SELECT * FROM settlements WHERE id=?")
          .bind(id(parts[1]))
          .first();
        if (
          !settlement ||
          !(await member(db, settlement.group_id, user.id))
        )
          return json(
            request,
            env,
            { error: "Settlement not found." },
            404,
          );
        await db
          .prepare("DELETE FROM settlements WHERE id=?")
          .bind(settlement.id)
          .run();
        return new Response(null, {
          status: 204,
          headers: cors(request, env),
        });
      }
      return json(
        request,
        env,
        { error: "Route not found." },
        404,
      );
    } catch (error) {
      console.error(error);
      if (error.message === "GROUP_NOT_FOUND")
        return json(
          request,
          env,
          { error: "Group not found." },
          404,
        );
      if (String(error).includes("UNIQUE"))
        return json(
          request,
          env,
          { error: "That email is already registered." },
          400,
        );
      return json(
        request,
        env,
        { error: "Server error." },
        500,
      );
    }
  },
};
