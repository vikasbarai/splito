const encoder = new TextEncoder(),
  decoder = new TextDecoder();
const id = (value) => Number.parseInt(value, 10);

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
      "GET, POST, DELETE, OPTIONS",
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
  const splits = await db
    .prepare(
      "SELECT e.paid_by,e.amount_cents,s.user_id,s.amount_cents AS split_cents FROM expenses e JOIN expense_splits s ON s.expense_id=e.id WHERE e.group_id=?",
    )
    .bind(groupId)
    .all();
  for (const row of splits.results) {
    result.get(row.paid_by).balance_cents +=
      row.amount_cents;
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
        };
        return json(request, env, {
          user,
          token: await signToken(user, env.JWT_SECRET),
        });
      }
      const user = await currentUser(request, env);
      if (!user)
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
            "SELECT e.*,g.name group_name,u.name payer_name FROM expenses e JOIN groups g ON g.id=e.group_id JOIN users u ON u.id=e.paid_by JOIN group_members gm ON gm.group_id=g.id WHERE gm.user_id=? ORDER BY e.created_at DESC LIMIT 20",
          )
          .bind(user.id)
          .all();
        return json(request, env, {
          groups: groups.results,
          activity: activity.results,
        });
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
          balances: await balances(db, groupId),
        });
      }
      if (
        parts[0] === "groups" &&
        parts[2] === "invites" &&
        request.method === "POST"
      ) {
        const groupId = id(parts[1]);
        await ensureGroup(db, groupId, user.id);
        const { email } = await request.json(),
          cleanEmail = email?.toLowerCase().trim();
        if (!cleanEmail?.includes("@"))
          return json(
            request,
            env,
            { error: "Enter a valid email." },
            400,
          );
        const invite = crypto.randomUUID();
        await db
          .prepare(
            "INSERT INTO invites(group_id,email,token,invited_by) VALUES(?,?,?,?)",
          )
          .bind(groupId, cleanEmail, invite, user.id)
          .run();
        return json(
          request,
          env,
          {
            token: invite,
            inviteUrl: `${env.FRONTEND_URL || new URL(request.url).origin}/?invite=${invite}`,
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
        await db.batch([
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
        ]);
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
        const data = await request.json(),
          cents = Math.round(Number(data.amount) * 100),
          payer = Number(data.paidBy),
          people = [
            ...new Set(
              (data.participants || []).map(Number),
            ),
          ];
        if (
          !data.description?.trim() ||
          !Number.isSafeInteger(cents) ||
          cents < 1
        )
          return json(
            request,
            env,
            {
              error:
                "Add a description and a valid amount.",
            },
            400,
          );
        if (
          !(await member(db, groupId, payer)) ||
          !people.length ||
          (
            await Promise.all(
              people.map((person) =>
                member(db, groupId, person),
              ),
            )
          ).includes(false)
        )
          return json(
            request,
            env,
            {
              error:
                "Choose valid group members and payer.",
            },
            400,
          );
        const expenseId = (
            await db
              .prepare(
                "INSERT INTO expenses(group_id,description,amount_cents,paid_by,category,expense_date,notes) VALUES(?,?,?,?,?,?,?)",
              )
              .bind(
                groupId,
                data.description.trim(),
                cents,
                payer,
                data.category || "other",
                data.date ||
                  new Date().toISOString().slice(0, 10),
                data.notes || null,
              )
              .run()
          ).meta.last_row_id,
          each = Math.floor(cents / people.length),
          remainder = cents % people.length;
        await db.batch(
          people.map((person, index) =>
            db
              .prepare(
                "INSERT INTO expense_splits(expense_id,user_id,amount_cents) VALUES(?,?,?)",
              )
              .bind(
                expenseId,
                person,
                each + (index < remainder ? 1 : 0),
              ),
          ),
        );
        return json(request, env, { id: expenseId }, 201);
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
        if (expense.paid_by !== user.id)
          return json(
            request,
            env,
            {
              error:
                "Only the person who added this expense can delete it.",
            },
            403,
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
        const { paidTo, amount } = await request.json(),
          cents = Math.round(Number(amount) * 100),
          recipient = Number(paidTo);
        if (
          !Number.isSafeInteger(cents) ||
          cents < 1 ||
          recipient === user.id ||
          !(await member(db, groupId, recipient))
        )
          return json(
            request,
            env,
            {
              error:
                "Choose a group member and a valid amount.",
            },
            400,
          );
        await db
          .prepare(
            "INSERT INTO settlements(group_id,paid_by,paid_to,amount_cents) VALUES(?,?,?,?)",
          )
          .bind(groupId, user.id, recipient, cents)
          .run();
        return json(request, env, { ok: true }, 201);
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
