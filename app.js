const $ = (s) => document.querySelector(s);
let token = localStorage.getItem("splito-token"),
  me,
  dash,
  activeGroup,
  mode = "register";
const money = (c) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "INR",
    }).format(Math.abs(c || 0) / 100),
  initials = (n) =>
    n
      .split(" ")
      .map((x) => x[0])
      .join("")
      .slice(0, 2),
  avatar = (n, i = 0) =>
    `<div class="avatar ${["orange", "purple", "blue", "pink", "green"][i % 5]}">${initials(n)}</div>`;
const esc = (s) =>
  String(s || "").replace(
    /[&<>'"]/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#039;",
        '"': "&quot;",
      })[c],
  );
async function api(url, o = {}) {
  const r = await fetch("/api" + url, {
    ...o,
    headers: {
      "Content-Type": "application/json",
      ...(token
        ? { Authorization: "Bearer " + token }
        : {}),
      ...(o.headers || {}),
    },
  });
  if (r.status === 204) return;
  const b = await r.json();
  if (!r.ok) throw Error(b.error);
  return b;
}
function toast(x) {
  const t = $("#toast");
  t.textContent = x;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2400);
}
function bal(g, id = me.id) {
  return (
    g.balances?.find((x) => x.id === id)?.balance_cents || 0
  );
}
function ico(c) {
  return (
    {
      food: "🍝",
      travel: "✈️",
      home: "🏠",
      groceries: "🛒",
      transport: "🚕",
    }[c] || "✦"
  );
}
function activity(e) {
  return `<div class="activity-item"><div class="expense-icon">${ico(e.category)}</div><div class="activity-main"><strong>${esc(e.description)}</strong><span>${esc(e.payer_name)} paid · ${esc(e.group_name || activeGroup?.group.name)} · ${e.expense_date}</span></div><div class="activity-amount"><b>${money(e.amount_cents)}</b></div></div>`;
}
function render() {
  const gs = dash.groups || [],
    net = gs.reduce((a, g) => a + bal(g), 0),
    owed = gs.reduce((a, g) => a + Math.max(bal(g), 0), 0),
    owing = gs.reduce(
      (a, g) => a + Math.max(-bal(g), 0),
      0,
    );
  $("#netBalance").textContent =
    (net < 0 ? "−" : "") + money(net);
  $("#balanceMessage").textContent =
    net > 0
      ? "You’re in the green — people owe you."
      : net < 0
        ? "A little settling up and you’re golden."
        : "All settled up. Nice!";
  $("#owedTotal").textContent = money(owed);
  $("#owingTotal").textContent = money(owing);
  $(".owed").style.width =
    (owed + owing ? (owed / (owed + owing)) * 100 : 50) +
    "%";
  $(".owing").style.width =
    (owed + owing ? (owing / (owed + owing)) * 100 : 50) +
    "%";
  $("#groupNav").innerHTML = gs
    .map(
      (g) =>
        `<button class="group-link" data-group="${g.id}">${g.emoji} &nbsp;${esc(g.name)}</button>`,
    )
    .join("");
  $("#groupsGrid").innerHTML =
    gs
      .map((g) => {
        let b = bal(g);
        return `<article class="group-card" data-group="${g.id}"><div class="group-top"><div class="group-icon" style="background:#dff3e9">${g.emoji}</div><button class="more">•••</button></div><h3>${esc(g.name)}</h3><span class="member-count">${g.member_count} member${g.member_count === 1 ? "" : "s"}</span><div class="card-line"></div><div class="group-balance ${b < 0 ? "negative" : ""}">${b >= 0 ? "You are owed" : "You owe"} <strong>${money(b)}</strong></div></article>`;
      })
      .join("") ||
    "<p>Create a group to start sharing expenses.</p>";
  const a =
    dash.activity.map(activity).join("") ||
    "<p>No expenses yet.</p>";
  $("#recentActivity").innerHTML = a;
  $("#allActivity").innerHTML = a;
  const friends = new Map();
  gs.forEach((g) =>
    g.balances
      .filter((x) => x.id !== me.id)
      .forEach((x) => friends.set(x.id, x)),
  );
  const f =
    [...friends.values()]
      .map(
        (p, i) =>
          `<div class="friend">${avatar(p.name, i)}<div class="friend-info"><strong>${esc(p.name)}</strong><small>${p.balance_cents > 0 ? "owes you" : p.balance_cents < 0 ? "you owe" : "settled up"}</small></div><div class="friend-balance ${p.balance_cents < 0 ? "negative" : ""}"><b>${p.balance_cents ? money(p.balance_cents) : "Settled"}</b></div></div>`,
      )
      .join("") ||
    "<p>Invite friends to a group to split expenses.</p>";
  $("#friendList").innerHTML = f;
  $("#allFriends").innerHTML = f;
}
async function load() {
  dash = await api("/dashboard");
  render();
}
function view(n) {
  document
    .querySelectorAll(".view")
    .forEach((x) => x.classList.add("hidden"));
  $("#" + n + "View").classList.remove("hidden");
  $("#pageTitle").textContent =
    n === "dashboard"
      ? "Your expenses"
      : n === "activity"
        ? "Activity"
        : n === "friends"
          ? "Friends"
          : activeGroup.group.name;
  document
    .querySelectorAll(".nav-link")
    .forEach((x) =>
      x.classList.toggle("active", x.dataset.view === n),
    );
}
async function openGroup(id) {
  activeGroup = await api("/groups/" + id);
  let g = activeGroup.group;
  $("#detailTitle").textContent = g.emoji + " " + g.name;
  $("#detailMembers").textContent = activeGroup.members
    .map((x) => x.name)
    .join(" · ");
  $("#detailBalances").innerHTML = activeGroup.balances
    .map(
      (x, i) =>
        `<div class="friend">${avatar(x.name, i)}<div class="friend-info"><strong>${esc(x.name)}</strong><small>${x.balance_cents > 0 ? "is owed" : x.balance_cents < 0 ? "owes" : "is settled up"}</small></div><div class="friend-balance ${x.balance_cents < 0 ? "negative" : ""}"><b>${money(x.balance_cents)}</b></div></div>`,
    )
    .join("");
  $("#detailExpenses").innerHTML =
    activeGroup.expenses.map(activity).join("") ||
    "<p>No expenses in this group yet.</p>";
  $("#detailSettlements").innerHTML =
    activeGroup.settlements
      .map(
        (s) =>
          `<div class="activity-item"><div class="expense-icon">✓</div><div class="activity-main"><strong>${esc(s.payer_name)} paid ${esc(s.payee_name)}</strong><span>${s.settled_at.slice(0, 10)}</span></div><div class="activity-amount"><b>${money(s.amount_cents)}</b></div></div>`,
      )
      .join("") || "<p>No settlements yet.</p>";
  view("group");
}
async function fillExpense() {
  let s = $("#expenseGroup");
  s.innerHTML = dash.groups
    .map(
      (g) =>
        `<option value="${g.id}" ${activeGroup?.group.id === g.id ? "selected" : ""}>${g.emoji} ${esc(g.name)}</option>`,
    )
    .join("");
  async function update() {
    let g = await api("/groups/" + s.value);
    $("#expensePayer").innerHTML = g.members
      .map(
        (x) =>
          `<option value="${x.id}" ${x.id === me.id ? "selected" : ""}>${esc(x.name)}</option>`,
      )
      .join("");
    $("#expenseParticipants").innerHTML = g.members
      .map(
        (x) =>
          `<option value="${x.id}" selected>${esc(x.name)}</option>`,
      )
      .join("");
  }
  s.onchange = update;
  await update();
}
function expense() {
  if (!dash.groups.length)
    return toast("Create a group first.");
  fillExpense();
  $("#expenseDialog").showModal();
}
$("#authToggle").onclick = () => {
  mode = mode === "register" ? "login" : "register";
  $("#authSubmit").textContent =
    mode === "register" ? "Create account" : "Sign in";
  $("#authToggle").textContent =
    mode === "register"
      ? "Already have an account? Sign in"
      : "New here? Create an account";
  $("#authForm").elements.name.closest(
    "label",
  ).style.display = mode === "register" ? "grid" : "none";
};
$("#authForm").onsubmit = async (e) => {
  e.preventDefault();
  try {
    let r = await api("/auth/" + mode, {
      method: "POST",
      body: JSON.stringify(
        Object.fromEntries(new FormData(e.target)),
      ),
    });
    token = r.token;
    me = r.user;
    localStorage.setItem("splito-token", token);
    $("#authScreen").classList.add("hidden");
    $("#profileName").textContent = me.name;
    $("#profileAvatar").textContent = initials(me.name);
    await load();
    acceptInvite();
  } catch (x) {
    $("#authError").textContent = x.message;
  }
};
$("#newGroupBtn").onclick = () =>
  $("#groupDialog").showModal();
$("#addExpenseBtn").onclick = expense;
$("#detailExpenseBtn").onclick = expense;
$("#groupForm").onsubmit = async (e) => {
  if (e.submitter?.value === "cancel") return;
  let f = new FormData(e.target);
  try {
    let r = await api("/groups", {
      method: "POST",
      body: JSON.stringify({
        name: f.get("name"),
        emoji: f.get("emoji"),
      }),
    });
    toast("Group created");
    await load();
    openGroup(r.id);
  } catch (x) {
    toast(x.message);
  }
};
$("#expenseForm").onsubmit = async (e) => {
  if (e.submitter?.value === "cancel") return;
  let f = new FormData(e.target);
  try {
    await api("/groups/" + f.get("group") + "/expenses", {
      method: "POST",
      body: JSON.stringify({
        description: f.get("description"),
        amount: f.get("amount"),
        paidBy: f.get("payer"),
        participants: f.getAll("participants"),
        date: new Date().toISOString().slice(0, 10),
      }),
    });
    toast("Expense added");
    await load();
    if (activeGroup) openGroup(activeGroup.group.id);
  } catch (x) {
    toast(x.message);
  }
};
$("#settleBtn").onclick = async () => {
  let g =
    activeGroup ||
    (await api("/groups/" + dash.groups[0]?.id));
  if (!g) return toast("Create a group first.");
  activeGroup = g;
  $("#settlePayee").innerHTML = g.members
    .filter((x) => x.id !== me.id)
    .map(
      (x) =>
        `<option value="${x.id}">${esc(x.name)}</option>`,
    )
    .join("");
  $("#settleDialog").showModal();
};
$("#settleForm").onsubmit = async (e) => {
  if (e.submitter?.value === "cancel") return;
  let f = new FormData(e.target);
  try {
    await api(
      "/groups/" + activeGroup.group.id + "/settlements",
      {
        method: "POST",
        body: JSON.stringify({
          paidTo: f.get("payee"),
          amount: f.get("amount"),
        }),
      },
    );
    toast("Settlement recorded");
    await load();
    openGroup(activeGroup.group.id);
  } catch (x) {
    toast(x.message);
  }
};
$("#inviteMemberBtn").onclick = () =>
  $("#inviteDialog").showModal();
$("#inviteForm").onsubmit = async (e) => {
  if (e.submitter?.value === "cancel") return;
  let f = new FormData(e.target);
  try {
    let r = await api(
      "/groups/" + activeGroup.group.id + "/invites",
      {
        method: "POST",
        body: JSON.stringify({ email: f.get("email") }),
      },
    );
    await navigator.clipboard.writeText(r.inviteUrl);
    toast("Invite link copied");
  } catch (x) {
    toast(x.message);
  }
};
$("#logoutBtn").onclick = () => {
  localStorage.removeItem("splito-token");
  location.reload();
};
$("#backToDashboard").onclick = () => view("dashboard");
$("#inviteBtn").onclick = () =>
  toast("Open a group to invite people.");
$("#addFriendBtn").onclick = () =>
  toast("Open a group to invite people.");
document.addEventListener("click", (e) => {
  let v = e.target.closest("[data-view]")?.dataset.view,
    id = e.target.closest("[data-group]")?.dataset.group;
  if (v) view(v);
  if (id) openGroup(id);
});
async function acceptInvite() {
  let i = new URLSearchParams(location.search).get(
    "invite",
  );
  if (!i) return;
  try {
    let r = await api("/invites/" + i + "/accept", {
      method: "POST",
    });
    history.replaceState({}, "", location.pathname);
    toast("You joined the group!");
    await load();
    openGroup(r.groupId);
  } catch (x) {
    toast(x.message);
  }
}
function dismissFromPointer(e) {
  const dialog = document.querySelector("dialog[open]");
  if (!dialog) return;
  const r = dialog.getBoundingClientRect();
  const inCloseZone =
    e.clientX >= r.right - 72 &&
    e.clientX <= r.right &&
    e.clientY >= r.top &&
    e.clientY <= r.top + 72;
  if (e.target.closest("dialog .close") || inCloseZone) {
    e.preventDefault();
    e.stopPropagation();
    dialog.close();
  }
}
document.addEventListener(
  "pointerdown",
  dismissFromPointer,
  true,
);
document.addEventListener(
  "click",
  dismissFromPointer,
  true,
);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape")
    document.querySelector("dialog[open]")?.close();
});
(async () => {
  if (!token) return;
  try {
    me = (await api("/me")).user;
    $("#profileName").textContent = me.name;
    $("#profileAvatar").textContent = initials(me.name);
    $("#authScreen").classList.add("hidden");
    await load();
    acceptInvite();
  } catch {
    localStorage.removeItem("splito-token");
  }
})();
