const $ = (selector) => document.querySelector(selector);

let token = localStorage.getItem("splito-token");
let me;
let dash = { groups: [], activity: [], friends: [] };
let activeGroup;
let mode = "register";

const money = (cents) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(Math.abs(Number(cents) || 0) / 100);
const today = () => new Date().toISOString().slice(0, 10);
const initials = (name) =>
  String(name || "?")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#039;",
        '"': "&quot;",
      })[character],
  );
const avatar = (name, index = 0) =>
  `<div class="avatar ${["orange", "purple", "blue", "pink", "green"][index % 5]}">${esc(initials(name))}</div>`;
const categoryIcon = (category) =>
  ({
    food: "&#x1F35D;",
    travel: "&#x2708;&#xFE0F;",
    home: "&#x1F3E0;",
    groceries: "&#x1F6D2;",
    transport: "&#x1F695;",
    settlement: "&#x2713;",
  })[category] || "&#x2726;";

async function api(url, options = {}) {
  const base = (window.SPLITO_API_URL || "").replace(
    /\/$/,
    "",
  );
  if (!base)
    throw Error(
      "This site has not been configured with its API URL.",
    );
  const response = await fetch(`${base}/api${url}`, {
    ...options,
    headers: {
      ...(options.body
        ? { "Content-Type": "application/json" }
        : {}),
      ...(token
        ? { Authorization: `Bearer ${token}` }
        : {}),
      ...(options.headers || {}),
    },
  });
  if (response.status === 204) return undefined;
  const raw = await response.text();
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = {
      error: "The server returned an invalid response.",
    };
  }
  if (!response.ok)
    throw Error(
      body.error || `Request failed (${response.status}).`,
    );
  return body;
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(
    () => element.classList.remove("show"),
    2800,
  );
}

function setFormStatus(
  selector,
  message = "",
  isError = false,
) {
  const element = $(selector);
  element.textContent = message;
  element.classList.toggle("error", isError);
}

function showOutdatedPageMessage() {
  const message =
    "This page is out of date. Refresh with Ctrl+F5 and try again.";
  const authError = $("#authError");
  if (authError) authError.textContent = message;
  if ($("#toast")) toast(message);
}

function updateAccountUI() {
  $("#profileName").textContent = me.name;
  $("#profileAvatar").textContent = initials(me.name);
  $("#pageKicker").textContent =
    `WELCOME, ${me.name.toUpperCase()}`;
}

function balanceFor(group, userId = me?.id) {
  return (
    group.balances?.find((person) => person.id === userId)
      ?.balance_cents || 0
  );
}

function activityMarkup(entry, controls = false) {
  const date =
    entry.activity_date || entry.expense_date || "";
  const isSettlement = entry.entry_type === "settlement";
  const title = isSettlement
    ? `${entry.payer_name} settled up`
    : entry.description;
  const detail = isSettlement
    ? `${entry.group_name || "Group"} - ${date}`
    : `${entry.payer_name} paid - ${entry.group_name || activeGroup?.group.name || "Group"} - ${date}`;
  const actions = controls
    ? `<span class="entry-actions"><button class="entry-button" type="button" data-edit-expense="${entry.id}">Edit</button><button class="entry-button danger" type="button" data-delete-expense="${entry.id}">Delete</button></span>`
    : "";
  return `<div class="activity-item"><div class="expense-icon">${categoryIcon(entry.category)}</div><div class="activity-main"><strong>${esc(title)}</strong><span>${esc(detail)}</span></div><div class="activity-amount"><b>${money(entry.amount_cents)}</b>${actions}</div></div>`;
}

function settlementMarkup(entry, controls = false) {
  const actions = controls
    ? `<span class="entry-actions"><button class="entry-button" type="button" data-edit-settlement="${entry.id}">Edit</button><button class="entry-button danger" type="button" data-delete-settlement="${entry.id}">Delete</button></span>`
    : "";
  return `<div class="activity-item"><div class="expense-icon">&#x2713;</div><div class="activity-main"><strong>${esc(entry.payer_name)} paid ${esc(entry.payee_name)}</strong><span>${esc(String(entry.settled_at).slice(0, 10))}</span></div><div class="activity-amount"><b>${money(entry.amount_cents)}</b>${actions}</div></div>`;
}

function render() {
  const groups = dash.groups || [];
  const net = groups.reduce(
    (sum, group) => sum + balanceFor(group),
    0,
  );
  const owed = groups.reduce(
    (sum, group) => sum + Math.max(balanceFor(group), 0),
    0,
  );
  const owing = groups.reduce(
    (sum, group) => sum + Math.max(-balanceFor(group), 0),
    0,
  );
  const total = owed + owing;
  $("#netBalance").textContent =
    `${net < 0 ? "-" : ""}${money(net)}`;
  $("#balanceMessage").textContent =
    net > 0
      ? "You are in the green - people owe you."
      : net < 0
        ? "A little settling up and you are golden."
        : "All settled up. Nice!";
  $("#owedTotal").textContent = money(owed);
  $("#owingTotal").textContent = money(owing);
  $(".owed").style.width =
    `${total ? (owed / total) * 100 : 50}%`;
  $(".owing").style.width =
    `${total ? (owing / total) * 100 : 50}%`;
  $("#groupNav").innerHTML = groups
    .map(
      (group) =>
        `<button class="group-link" type="button" data-group="${group.id}">${esc(group.emoji)} ${esc(group.name)}</button>`,
    )
    .join("");
  $("#groupsGrid").innerHTML =
    groups
      .map((group) => {
        const balance = balanceFor(group);
        return `<article class="group-card" data-group="${group.id}"><div class="group-top"><div class="group-icon" style="background:#dff3e9">${esc(group.emoji)}</div></div><h3>${esc(group.name)}</h3><span class="member-count">${group.member_count} member${group.member_count === 1 ? "" : "s"}</span><div class="card-line"></div><div class="group-balance ${balance < 0 ? "negative" : ""}">${balance >= 0 ? "You are owed" : "You owe"} <strong>${money(balance)}</strong></div></article>`;
      })
      .join("") ||
    "<p>Create a group to start sharing expenses.</p>";
  const activity =
    dash.activity
      .map((entry) => activityMarkup(entry))
      .join("") || "<p>No activity yet.</p>";
  $("#recentActivity").innerHTML = activity;
  $("#allActivity").innerHTML = activity;
  const people =
    (dash.friends || [])
      .map(
        (person, index) =>
          `<div class="friend">${avatar(person.name, index)}<div class="friend-info"><strong>${esc(person.name)}</strong><small>${person.shared_group_count ? `${person.shared_group_count} shared group${person.shared_group_count === 1 ? "" : "s"}` : "No shared groups yet"}</small></div><div class="friend-balance"><b>Friend</b><button class="entry-button danger member-friend-button" type="button" data-unfriend="${person.id}">Unfriend</button></div></div>`,
      )
      .join("") ||
    "<p>Add friends to your account, then select them when adding members to a group.</p>";
  $("#friendList").innerHTML = people;
  $("#allFriends").innerHTML = people;
}

async function load() {
  dash = await api("/dashboard");
  render();
}

function view(name) {
  document
    .querySelectorAll(".view")
    .forEach((element) => element.classList.add("hidden"));
  $(`#${name}View`).classList.remove("hidden");
  $("#pageTitle").textContent =
    name === "dashboard"
      ? "Your expenses"
      : name === "activity"
        ? "Activity"
        : name === "friends"
          ? "Friends"
          : activeGroup?.group.name || "Group";
  document
    .querySelectorAll(".nav-link")
    .forEach((element) => {
      element.classList.toggle(
        "active",
        element.dataset.view === name,
      );
    });
}

async function openGroup(groupId) {
  activeGroup = await api(`/groups/${groupId}`);
  const group = activeGroup.group;
  $("#detailTitle").textContent =
    `${group.emoji} ${group.name}`;
  $("#detailMembers").textContent = activeGroup.members
    .map((person) => person.name)
    .join(" · ");
  const friendIds = new Set(
    (dash.friends || []).map((friend) => friend.id),
  );
  $("#detailBalances").innerHTML = activeGroup.balances
    .map((person, index) => {
      const friendAction =
        person.id === me.id
          ? ""
          : friendIds.has(person.id)
            ? '<span class="member-friend-status">Friend</span>'
            : `<button class="entry-button member-friend-button" type="button" data-add-friend="${person.id}">Add friend</button>`;
      return `<div class="friend">${avatar(person.name, index)}<div class="friend-info"><strong>${esc(person.name)}</strong><small>${person.balance_cents > 0 ? "is owed" : person.balance_cents < 0 ? "owes" : "is settled up"}</small></div><div class="friend-balance ${person.balance_cents < 0 ? "negative" : ""}"><b>${money(person.balance_cents)}</b>${friendAction}</div></div>`;
    })
    .join("");
  $("#detailInvites").innerHTML =
    (activeGroup.invites || [])
      .map((invite) => {
        const completed = Boolean(invite.accepted_at);
        const date = String(
          completed
            ? invite.accepted_at
            : invite.created_at,
        ).slice(0, 16);
        return `<div class="activity-item invite-item"><div class="expense-icon">&#x2709;&#xFE0F;</div><div class="activity-main"><strong>${esc(invite.email)}</strong><span>${completed ? "Accepted" : "Sent"} ${esc(date)}${invite.add_to_friends ? " - added to Friends on acceptance" : ""}</span></div><div class="invite-status ${completed ? "completed" : "pending"}">${completed ? "Completed" : "Pending"}</div></div>`;
      })
      .join("") ||
    "<p>No invitations have been sent for this group.</p>";
  $("#detailExpenses").innerHTML =
    activeGroup.expenses
      .map((entry) => activityMarkup(entry, true))
      .join("") || "<p>No expenses in this group yet.</p>";
  $("#detailSettlements").innerHTML =
    activeGroup.settlements
      .map((entry) => settlementMarkup(entry, true))
      .join("") || "<p>No settlements yet.</p>";
  view("group");
}

async function refreshAfterMutation(groupId) {
  await load();
  await openGroup(groupId);
}

function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}
function closeDialog(dialog) {
  if (dialog?.open) dialog.close();
}

async function addGroupMemberAsFriend(friendId) {
  const friend = activeGroup?.members.find(
    (member) => member.id === friendId,
  );
  if (!friend || friend.id === me.id)
    return toast(
      "Choose another group member to add as a friend.",
    );
  try {
    const result = await api("/friends", {
      method: "POST",
      body: JSON.stringify({ email: friend.email }),
    });
    const groupId = activeGroup.group.id;
    await load();
    await openGroup(groupId);
    toast(
      `${result.friend.name} was added to your Friends list.`,
    );
  } catch (error) {
    toast(error.message);
  }
}

async function unfriend(friendId) {
  const friend = (dash.friends || []).find(
    (person) => person.id === friendId,
  );
  if (!friend)
    return toast(
      "That person is not in your Friends list.",
    );
  if (
    !window.confirm(
      `Remove ${friend.name} from your Friends list? They will remain in shared groups.`,
    )
  )
    return;
  try {
    await api(`/friends/${friendId}`, { method: "DELETE" });
    const groupId = activeGroup?.group.id;
    await load();
    if (groupId) await openGroup(groupId);
    toast(
      `${friend.name} was removed from your Friends list.`,
    );
  } catch (error) {
    toast(error.message);
  }
}

async function populateExpenseMembers(
  groupId,
  selected = [],
  paidBy = me.id,
) {
  const group = await api(`/groups/${groupId}`);
  const participants = selected.length
    ? new Set(selected.map(Number))
    : new Set(group.members.map((person) => person.id));
  $("#expensePayer").innerHTML = group.members
    .map(
      (person) =>
        `<option value="${person.id}" ${person.id === Number(paidBy) ? "selected" : ""}>${esc(person.name)}</option>`,
    )
    .join("");
  $("#expenseParticipants").innerHTML = group.members
    .map(
      (person) =>
        `<option value="${person.id}" ${participants.has(person.id) ? "selected" : ""}>${esc(person.name)}</option>`,
    )
    .join("");
}

async function openExpense(entry) {
  if (!dash.groups.length)
    return toast("Create a group first.");
  const form = $("#expenseForm");
  const groupSelect = $("#expenseGroup");
  form.reset();
  form.elements.entryId.value = entry?.id || "";
  $("#expenseDialogEyebrow").textContent = entry
    ? "EDIT EXPENSE"
    : "NEW EXPENSE";
  $("#expenseDialogTitle").textContent = entry
    ? "Edit expense"
    : "Add an expense";
  $("#expenseSubmit").textContent = entry
    ? "Save changes"
    : "Add expense";
  groupSelect.disabled = Boolean(entry);
  groupSelect.innerHTML = dash.groups
    .map(
      (group) =>
        `<option value="${group.id}">${esc(group.emoji)} ${esc(group.name)}</option>`,
    )
    .join("");
  const groupId =
    entry?.group_id ||
    activeGroup?.group.id ||
    dash.groups[0].id;
  groupSelect.value = groupId;
  form.elements.description.value =
    entry?.description || "";
  form.elements.amount.value = entry
    ? (entry.amount_cents / 100).toFixed(2)
    : "";
  form.elements.date.value = entry?.expense_date || today();
  form.elements.category.value = entry?.category || "other";
  form.elements.notes.value = entry?.notes || "";
  groupSelect.onchange = () =>
    populateExpenseMembers(groupSelect.value);
  await populateExpenseMembers(
    groupId,
    entry?.splits?.map((split) => split.user_id),
    entry?.paid_by || me.id,
  );
  openDialog($("#expenseDialog"));
}

function openGroupDialog(group) {
  const form = $("#groupForm");
  form.reset();
  form.elements.groupId.value = group?.id || "";
  form.elements.name.value = group?.name || "";
  form.elements.emoji.value = group?.emoji || "";
  $("#groupDialogEyebrow").textContent = group
    ? "EDIT GROUP"
    : "NEW GROUP";
  $("#groupDialogTitle").textContent = group
    ? "Edit group"
    : "Create a group";
  $("#groupSubmit").textContent = group
    ? "Save changes"
    : "Create group";
  openDialog($("#groupDialog"));
}

async function populateSettlementMembers(
  groupId,
  selected = {},
) {
  const group = await api(`/groups/${groupId}`);
  const payer = $("#settlePayer");
  const payee = $("#settlePayee");
  payer.innerHTML = group.members
    .map(
      (person) =>
        `<option value="${person.id}" ${person.id === Number(selected.paidBy || me.id) ? "selected" : ""}>${esc(person.name)}</option>`,
    )
    .join("");
  const setPayees = () => {
    const payerId = Number(payer.value);
    payee.innerHTML = group.members
      .filter((person) => person.id !== payerId)
      .map(
        (person) =>
          `<option value="${person.id}">${esc(person.name)}</option>`,
      )
      .join("");
    if (
      [...payee.options].some(
        (option) =>
          Number(option.value) === Number(selected.paidTo),
      )
    ) {
      payee.value = selected.paidTo;
    }
  };
  payer.onchange = setPayees;
  setPayees();
}

async function openSettlement(entry) {
  if (!dash.groups.length)
    return toast("Create a group first.");
  const form = $("#settleForm");
  const groupSelect = $("#settleGroup");
  form.reset();
  form.elements.entryId.value = entry?.id || "";
  $("#settleDialogEyebrow").textContent = entry
    ? "EDIT SETTLEMENT"
    : "SETTLE A BALANCE";
  $("#settleDialogTitle").textContent = entry
    ? "Edit payment"
    : "Record a payment";
  $("#settleSubmit").textContent = entry
    ? "Save changes"
    : "Record payment";
  groupSelect.disabled = Boolean(entry);
  groupSelect.innerHTML = dash.groups
    .map(
      (group) =>
        `<option value="${group.id}">${esc(group.emoji)} ${esc(group.name)}</option>`,
    )
    .join("");
  const groupId =
    entry?.group_id ||
    activeGroup?.group.id ||
    dash.groups[0].id;
  groupSelect.value = groupId;
  form.elements.amount.value = entry
    ? (entry.amount_cents / 100).toFixed(2)
    : "";
  form.elements.settledAt.value =
    entry?.settled_at?.slice(0, 10) || today();
  groupSelect.onchange = () =>
    populateSettlementMembers(groupSelect.value);
  await populateSettlementMembers(groupId, {
    paidBy: entry?.paid_by || me.id,
    paidTo: entry?.paid_to,
  });
  if (!$("#settlePayee").options.length) {
    return toast(
      "This group needs at least two members to record a payment.",
    );
  }
  openDialog($("#settleDialog"));
}

async function openInvite() {
  if (!activeGroup)
    return toast("Open a group before inviting a member.");
  $("#inviteForm").reset();
  openDialog($("#inviteDialog"));
}

function openAddMember() {
  if (!activeGroup)
    return toast("Open a group before adding a friend.");
  const groupMemberIds = new Set(
    activeGroup.members.map((member) => member.id),
  );
  const availableFriends = (dash.friends || []).filter(
    (friend) => !groupMemberIds.has(friend.id),
  );
  const picker = $("#addMemberPicker");
  picker.innerHTML = availableFriends
    .map(
      (friend) =>
        `<option value="${friend.id}">${esc(friend.name)} (${esc(friend.email)})</option>`,
    )
    .join("");
  $("#addMemberSubmit").disabled = !availableFriends.length;
  $("#addMemberEmpty").hidden = Boolean(
    availableFriends.length,
  );
  $("#addMemberForm").reset();
  openDialog($("#addMemberDialog"));
}

function openFriendDialog() {
  $("#friendForm").reset();
  openDialog($("#friendDialog"));
}

function openForgotPassword() {
  const form = $("#forgotPasswordForm");
  const authForm = $("#authForm");
  const localLink = $("#localResetLink");
  if (!form || !authForm || !localLink) {
    showOutdatedPageMessage();
    return;
  }
  form.reset();
  form.elements.email.value = authForm.elements.email.value;
  setFormStatus("#forgotPasswordStatus");
  localLink.hidden = true;
  localLink.removeAttribute("href");
  openDialog($("#forgotPasswordDialog"));
}

function openResetFromUrl() {
  const token = new URLSearchParams(location.search).get(
    "reset",
  );
  if (!token) return;
  const form = $("#resetPasswordForm");
  if (!form || !$("#resetPasswordStatus")) {
    showOutdatedPageMessage();
    return;
  }
  form.reset();
  form.elements.token.value = token;
  setFormStatus("#resetPasswordStatus");
  openDialog($("#resetPasswordDialog"));
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

const forgotPasswordButton = $("#forgotPasswordBtn");
if (forgotPasswordButton) {
  forgotPasswordButton.onclick = openForgotPassword;
}

$("#authForm").onsubmit = async (event) => {
  event.preventDefault();
  try {
    const result = await api(`/auth/${mode}`, {
      method: "POST",
      body: JSON.stringify(
        Object.fromEntries(
          new FormData(event.currentTarget),
        ),
      ),
    });
    token = result.token;
    me = result.user;
    localStorage.setItem("splito-token", token);
    $("#authScreen").classList.add("hidden");
    updateAccountUI();
    await load();
    await acceptInvite();
  } catch (error) {
    $("#authError").textContent = error.message;
  }
};

const forgotPasswordForm = $("#forgotPasswordForm");
if (forgotPasswordForm) {
  forgotPasswordForm.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const result = await api("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({
          email: new FormData(event.currentTarget).get(
            "email",
          ),
        }),
      });
      setFormStatus(
        "#forgotPasswordStatus",
        result.message,
      );
      if (result.debugResetUrl) {
        const localLink = $("#localResetLink");
        localLink.href = result.debugResetUrl;
        localLink.textContent =
          "Open the local password-reset link";
        localLink.hidden = false;
        setFormStatus(
          "#forgotPasswordStatus",
          "A local reset link was generated. Open the link below.",
        );
      }
    } catch (error) {
      setFormStatus(
        "#forgotPasswordStatus",
        error.message,
        true,
      );
    }
  };
}

const resetPasswordForm = $("#resetPasswordForm");
if (resetPasswordForm) {
  resetPasswordForm.onsubmit = async (event) => {
    event.preventDefault();
    // currentTarget becomes null once an async event handler resumes after
    // awaiting a request, so keep the form reference before the await.
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (
      fields.get("newPassword") !==
      fields.get("confirmPassword")
    ) {
      setFormStatus(
        "#resetPasswordStatus",
        "New password and confirmation do not match.",
        true,
      );
      return;
    }
    try {
      const result = await api("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({
          token: fields.get("token"),
          newPassword: fields.get("newPassword"),
        }),
      });
      history.replaceState({}, "", location.pathname);
      form.reset();
      closeDialog($("#resetPasswordDialog"));
      toast(
        "Password reset successfully. You can now sign in.",
      );
    } catch (error) {
      setFormStatus(
        "#resetPasswordStatus",
        error.message,
        true,
      );
    }
  };
}

$("#newGroupBtn").onclick = () => openGroupDialog();
$("#accountSettingsBtn").onclick = () => {
  const form = $("#accountForm");
  form.reset();
  form.elements.name.value = me.name;
  form.elements.email.value = me.email;
  openDialog($("#accountDialog"));
};
$("#editGroupBtn").onclick = () =>
  activeGroup && openGroupDialog(activeGroup.group);
$("#addExpenseBtn").onclick = () =>
  openExpense().catch((error) => toast(error.message));
$("#detailExpenseBtn").onclick = () =>
  openExpense().catch((error) => toast(error.message));
$("#settleBtn").onclick = () =>
  openSettlement().catch((error) => toast(error.message));
$("#inviteMemberBtn").onclick = () =>
  openInvite().catch((error) => toast(error.message));
$("#addMemberBtn").onclick = openAddMember;
$("#addFriendFromDashboardBtn").onclick = openFriendDialog;
$("#addFriendBtn").onclick = openFriendDialog;

$("#groupForm").onsubmit = async (event) => {
  event.preventDefault();
  const fields = new FormData(event.currentTarget);
  const groupId = fields.get("groupId");
  try {
    const result = await api(
      groupId ? `/groups/${groupId}` : "/groups",
      {
        method: groupId ? "PUT" : "POST",
        body: JSON.stringify({
          name: fields.get("name"),
          emoji: fields.get("emoji") || "*",
        }),
      },
    );
    closeDialog($("#groupDialog"));
    toast(groupId ? "Group updated" : "Group created");
    await refreshAfterMutation(groupId || result.id);
  } catch (error) {
    toast(error.message);
  }
};

$("#accountForm").onsubmit = async (event) => {
  event.preventDefault();
  const fields = new FormData(event.currentTarget);
  const newPassword = fields.get("newPassword");
  if (newPassword !== fields.get("confirmPassword")) {
    toast("New password and confirmation do not match.");
    return;
  }
  try {
    const result = await api("/me", {
      method: "PUT",
      body: JSON.stringify({
        name: fields.get("name"),
        email: fields.get("email"),
        currentPassword: fields.get("currentPassword"),
        newPassword,
      }),
    });
    token = result.token;
    me = result.user;
    localStorage.setItem("splito-token", token);
    updateAccountUI();
    closeDialog($("#accountDialog"));
    const groupId = activeGroup?.group.id;
    await load();
    if (groupId) await openGroup(groupId);
    toast("Account settings saved");
  } catch (error) {
    toast(error.message);
  }
};

$("#expenseForm").onsubmit = async (event) => {
  event.preventDefault();
  const fields = new FormData(event.currentTarget);
  const entryId = fields.get("entryId");
  const groupId = entryId
    ? activeGroup.group.id
    : fields.get("group");
  try {
    await api(
      entryId
        ? `/expenses/${entryId}`
        : `/groups/${groupId}/expenses`,
      {
        method: entryId ? "PUT" : "POST",
        body: JSON.stringify({
          description: fields.get("description"),
          amount: fields.get("amount"),
          paidBy: fields.get("payer"),
          participants: fields.getAll("participants"),
          date: fields.get("date"),
          category: fields.get("category"),
          notes: fields.get("notes"),
        }),
      },
    );
    closeDialog($("#expenseDialog"));
    toast(entryId ? "Expense updated" : "Expense added");
    await refreshAfterMutation(groupId);
  } catch (error) {
    toast(error.message);
  }
};

$("#settleForm").onsubmit = async (event) => {
  event.preventDefault();
  const fields = new FormData(event.currentTarget);
  const entryId = fields.get("entryId");
  const groupId = entryId
    ? activeGroup.group.id
    : fields.get("group");
  try {
    await api(
      entryId
        ? `/settlements/${entryId}`
        : `/groups/${groupId}/settlements`,
      {
        method: entryId ? "PUT" : "POST",
        body: JSON.stringify({
          paidBy: fields.get("payer"),
          paidTo: fields.get("payee"),
          amount: fields.get("amount"),
          settledAt: fields.get("settledAt"),
        }),
      },
    );
    closeDialog($("#settleDialog"));
    toast(
      entryId ? "Payment updated" : "Settlement recorded",
    );
    await refreshAfterMutation(groupId);
  } catch (error) {
    toast(error.message);
  }
};

$("#inviteForm").onsubmit = async (event) => {
  event.preventDefault();
  if (!activeGroup)
    return toast("Open a group before inviting a member.");
  const form = event.currentTarget;
  const fields = new FormData(form);
  const groupId = activeGroup.group.id;
  try {
    const result = await api(`/groups/${groupId}/invites`, {
      method: "POST",
      body: JSON.stringify({
        email: fields.get("email"),
        addToFriends: fields.get("addToFriends") === "on",
      }),
    });
    closeDialog($("#inviteDialog"));
    await refreshAfterMutation(groupId);
    if (result.debugInviteUrl) {
      window.prompt(
        "Local email is not configured. Copy this invite link",
        result.debugInviteUrl,
      );
    } else
      toast(`Invitation email sent to ${result.email}.`);
  } catch (error) {
    toast(error.message);
  }
};

$("#addMemberForm").onsubmit = async (event) => {
  event.preventDefault();
  if (!activeGroup)
    return toast("Open a group before adding a friend.");
  const groupId = activeGroup.group.id;
  const friendIds = new FormData(
    event.currentTarget,
  ).getAll("friendIds");
  try {
    const result = await api(`/groups/${groupId}/members`, {
      method: "POST",
      body: JSON.stringify({ friendIds }),
    });
    closeDialog($("#addMemberDialog"));
    toast(
      `${result.members.length} friend${result.members.length === 1 ? "" : "s"} added to the group.`,
    );
    await refreshAfterMutation(groupId);
  } catch (error) {
    toast(error.message);
  }
};

$("#friendForm").onsubmit = async (event) => {
  event.preventDefault();
  const email = new FormData(event.currentTarget).get(
    "email",
  );
  try {
    const result = await api("/friends", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    closeDialog($("#friendDialog"));
    await load();
    toast(
      `${result.friend.name} was added to your Friends list.`,
    );
  } catch (error) {
    toast(error.message);
  }
};

async function deleteEntry(type, entryId, label) {
  if (
    !activeGroup ||
    !window.confirm(
      `Delete this ${label}? This cannot be undone.`,
    )
  )
    return;
  try {
    await api(`/${type}/${entryId}`, { method: "DELETE" });
    toast(
      `${label[0].toUpperCase()}${label.slice(1)} deleted`,
    );
    await refreshAfterMutation(activeGroup.group.id);
  } catch (error) {
    toast(error.message);
  }
}

$("#logoutBtn").onclick = () => {
  localStorage.removeItem("splito-token");
  location.reload();
};
$("#backToDashboard").onclick = () => view("dashboard");
$("#seeGroups").onclick = () =>
  $("#groupsGrid").scrollIntoView({
    behavior: "smooth",
    block: "start",
  });

document.addEventListener("click", (event) => {
  const addFriend = event.target.closest(
    "[data-add-friend]",
  );
  const unfriendButton = event.target.closest(
    "[data-unfriend]",
  );
  const editExpense = event.target.closest(
    "[data-edit-expense]",
  );
  const deleteExpense = event.target.closest(
    "[data-delete-expense]",
  );
  const editSettlement = event.target.closest(
    "[data-edit-settlement]",
  );
  const deleteSettlement = event.target.closest(
    "[data-delete-settlement]",
  );
  if (addFriend)
    return addGroupMemberAsFriend(
      Number(addFriend.dataset.addFriend),
    );
  if (unfriendButton)
    return unfriend(
      Number(unfriendButton.dataset.unfriend),
    );
  if (editExpense) {
    const entry = activeGroup?.expenses.find(
      (expense) =>
        expense.id ===
        Number(editExpense.dataset.editExpense),
    );
    if (entry)
      openExpense(entry).catch((error) =>
        toast(error.message),
      );
    return;
  }
  if (deleteExpense)
    return deleteEntry(
      "expenses",
      deleteExpense.dataset.deleteExpense,
      "expense",
    );
  if (editSettlement) {
    const entry = activeGroup?.settlements.find(
      (settlement) =>
        settlement.id ===
        Number(editSettlement.dataset.editSettlement),
    );
    if (entry)
      openSettlement(entry).catch((error) =>
        toast(error.message),
      );
    return;
  }
  if (deleteSettlement)
    return deleteEntry(
      "settlements",
      deleteSettlement.dataset.deleteSettlement,
      "settlement",
    );
  const targetView =
    event.target.closest("[data-view]")?.dataset.view;
  const targetGroup =
    event.target.closest("[data-group]")?.dataset.group;
  if (targetView) view(targetView);
  if (targetGroup)
    openGroup(targetGroup).catch((error) =>
      toast(error.message),
    );
});

async function acceptInvite() {
  const invite = new URLSearchParams(location.search).get(
    "invite",
  );
  if (!invite) return;
  try {
    const result = await api(`/invites/${invite}/accept`, {
      method: "POST",
    });
    history.replaceState({}, "", location.pathname);
    toast("You joined the group!");
    await load();
    await openGroup(result.groupId);
  } catch (error) {
    toast(error.message);
  }
}

function dismissFromPointer(event) {
  const dialog = document.querySelector("dialog[open]");
  if (!dialog) return;
  const bounds = dialog.getBoundingClientRect();
  const inCloseZone =
    event.clientX >= bounds.right - 72 &&
    event.clientX <= bounds.right &&
    event.clientY >= bounds.top &&
    event.clientY <= bounds.top + 72;
  if (
    event.target.closest("dialog .close") ||
    inCloseZone
  ) {
    event.preventDefault();
    event.stopPropagation();
    closeDialog(dialog);
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
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape")
    closeDialog(document.querySelector("dialog[open]"));
});

(async () => {
  openResetFromUrl();
  if (!token) return;
  try {
    me = (await api("/me")).user;
    updateAccountUI();
    $("#authScreen").classList.add("hidden");
    await load();
    await acceptInvite();
  } catch {
    localStorage.removeItem("splito-token");
  }
})();
