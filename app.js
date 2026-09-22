const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [
  ...document.querySelectorAll(selector),
];

let token = localStorage.getItem("splito-token");
let me;
let dash = { groups: [], activity: [], friends: [] };
let activeGroup;
let mode = "register";
let expenseSplitValues = {};
let accountAvatarImage = "";
let expenseReceiptImage = "";
let settlementReceiptImage = "";
let activityPage = 1;
let tipRequest = 0;
const defaultAvatarColor = "#d76e47";
const maxReceiptImageBytes = 500 * 1024;

const money = (cents) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(Math.abs(Number(cents) || 0) / 100);
const signedMoney = (cents) =>
  (Number(cents) < 0 ? "-" : "") + money(cents);
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
const avatar = (user, index = 0) => {
  const person =
    typeof user === "object" && user
      ? user
      : { name: user };
  const image = person.avatar_image || "";
  const style = [
    person.avatar_color &&
      "background-color:" + person.avatar_color,
    image && "background-image:url('" + image + "')",
  ]
    .filter(Boolean)
    .join(";");
  const color = [
    "orange",
    "purple",
    "blue",
    "pink",
    "green",
  ][index % 5];
  return `<div class="avatar ${color}${image ? " has-avatar-image" : ""}"${style ? ` style="${style}"` : ""}>${image ? "" : esc(person.avatar_emoji || initials(person.name))}</div>`;
};
function applyAvatar(element, user) {
  const image = user?.avatar_image || "";
  element.textContent = image
    ? ""
    : user?.avatar_emoji || initials(user?.name);
  element.classList.toggle(
    "has-avatar-image",
    Boolean(image),
  );
  element.style.backgroundImage = image
    ? 'url("' + image + '")'
    : "";
  element.style.backgroundColor = user?.avatar_color || "";
}
const categoryIcon = (category) =>
  ({
    food: "&#x1F35D;",
    travel: "&#x2708;&#xFE0F;",
    home: "&#x1F3E0;",
    groceries: "&#x1F6D2;",
    transport: "&#x1F695;",
    settlement: "&#x2713;",
  })[category] || "&#x2726;";
const emojiAndTextFromDescription = (description) => {
  const text = String(description || "");
  const emojiPattern =
    /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
  if (typeof Intl.Segmenter === "function") {
    const segments = [
      ...new Intl.Segmenter(undefined, {
        granularity: "grapheme",
      }).segment(text),
    ];
    const emojiIndex = segments.findIndex(({ segment }) =>
      emojiPattern.test(segment),
    );
    if (emojiIndex >= 0) {
      return {
        emoji: segments[emojiIndex].segment,
        text: segments
          .filter((_, index) => index !== emojiIndex)
          .map(({ segment }) => segment)
          .join("")
          .replace(/\s{2,}/g, " ")
          .trim(),
      };
    }
  }
  const match = text.match(emojiPattern);
  return match
    ? {
        emoji: match[0],
        text: text
          .replace(match[0], "")
          .replace(/[\uFE0E\uFE0F]/g, "")
          .replace(/\s{2,}/g, " ")
          .trim(),
      }
    : { emoji: "", text };
};

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

function showSignedInApp() {
  document.body.classList.add("is-authenticated");
  document.body.classList.remove("auth-pending");
  $("#authScreen").classList.add("hidden");
}

function showAuthenticationScreen() {
  document.body.classList.remove(
    "is-authenticated",
    "auth-pending",
  );
  $("#authScreen").classList.remove("hidden");
}

function updateAccountUI() {
  $("#profileName").textContent = me.name;
  applyAvatar($("#profileAvatar"), me);
  $("#mobileProfileName").textContent = me.name;
  applyAvatar($("#mobileProfileAvatar"), me);
  $("#mobileAccountSettingsBtn").setAttribute(
    "aria-label",
    `Open account settings for ${me.name}`,
  );
  $("#mobileAccountNavBtn").setAttribute(
    "aria-label",
    `Open account settings for ${me.name}`,
  );
  $("#pageKicker").textContent =
    `WELCOME, ${me.name.toUpperCase()}`;
}

function updateEmailVerificationUI() {
  const status = $("#accountEmailVerification");
  const message = $("#accountEmailVerificationText");
  const resend = $("#resendVerificationBtn");
  if (!status || !message || !resend) return;
  const verified = Boolean(me?.email_verified_at);
  message.textContent = verified
    ? "Email address verified."
    : "Verify your email address before sending group invitations.";
  resend.hidden = verified;
}

function balanceFor(group, userId = me?.id) {
  return (
    group.balances?.find((person) => person.id === userId)
      ?.balance_cents || 0
  );
}

function splitMethodLabel(entry) {
  const labels = {
    equal: "Split equally",
    exact: "Exact amounts",
    percentage: "By percentage",
    shares: "By shares",
    adjustment: "With adjustments",
  };
  if (labels[entry.split_method])
    return labels[entry.split_method];
  const amounts = (entry.splits || []).map((split) =>
    Number(split.amount_cents),
  );
  const isEqual =
    amounts.length > 0 &&
    amounts.every(Number.isSafeInteger) &&
    Math.max(...amounts) - Math.min(...amounts) <= 1;
  return isEqual ? "Split equally" : "Custom amounts";
}

function expenseSplitDetailsMarkup(entry) {
  if (!Array.isArray(entry.splits) || !entry.splits.length)
    return "";
  const payerId = Number(entry.paid_by);
  const breakdown = entry.splits
    .map((split) => {
      const name = esc(split.name || "Member");
      const amount = money(split.amount_cents);
      return Number(split.user_id) === payerId
        ? `${name}&#039;s share ${amount}`
        : `${name} owes ${amount}`;
    })
    .join('<span class="split-separator">&middot;</span>');
  return `<div class="expense-split-details"><span class="split-method-badge">${esc(splitMethodLabel(entry))}</span><span class="split-breakdown">${breakdown}</span></div>`;
}

function activityMarkup(entry, controls = false) {
  const date =
    entry.activity_date || entry.expense_date || "";
  const isSettlement = entry.entry_type === "settlement";
  const description = isSettlement
    ? { emoji: "", text: "" }
    : entry.emoji
      ? {
          emoji: entry.emoji,
          text: String(entry.description || "").trim(),
        }
      : emojiAndTextFromDescription(entry.description);
  const title = isSettlement
    ? `${entry.payer_name} settled up`
    : description.text || "Expense";
  const detail = isSettlement
    ? `${entry.group_name || "Group"} - ${date}`
    : `${entry.payer_name} paid - ${entry.group_name || activeGroup?.group.name || "Group"} - ${date}`;
  const splitDetails = isSettlement
    ? ""
    : expenseSplitDetailsMarkup(entry);
  const receipt = receiptLinkMarkup(entry);
  const actions = controls
    ? `<span class="entry-actions"><button class="entry-button" type="button" data-edit-expense="${entry.id}">Edit</button><button class="entry-button danger" type="button" data-delete-expense="${entry.id}">Delete</button></span>`
    : "";
  const icon = description.emoji
    ? esc(description.emoji)
    : categoryIcon(entry.category);
  return `<div class="activity-item"><div class="expense-icon">${icon}</div><div class="activity-main"><strong>${esc(title)}</strong><span>${esc(detail)}</span>${splitDetails}${receipt}</div><div class="activity-amount"><b>${money(entry.amount_cents)}</b>${actions}</div></div>`;
}

function settlementMarkup(entry, controls = false) {
  const actions = controls
    ? `<span class="entry-actions"><button class="entry-button" type="button" data-edit-settlement="${entry.id}">Edit</button><button class="entry-button danger" type="button" data-delete-settlement="${entry.id}">Delete</button></span>`
    : "";
  return `<div class="activity-item"><div class="expense-icon">&#x2713;</div><div class="activity-main"><strong>${esc(entry.payer_name)} paid ${esc(entry.payee_name)}</strong><span>${esc(String(entry.settled_at).slice(0, 10))}</span>${receiptLinkMarkup(entry)}</div><div class="activity-amount"><b>${money(entry.amount_cents)}</b>${actions}</div></div>`;
}

function receiptLinkMarkup(entry) {
  if (!entry.receipt_image) return "";
  return `<a class="entry-receipt" href="${esc(entry.receipt_image)}" target="_blank" rel="noopener">View receipt</a>`;
}

const localTips = [
  {
    quote:
      "A good budget leaves room for joy and one surprisingly expensive coffee.",
    author: "Splito",
  },
  {
    quote:
      "Money talks, but a clear split saves everyone from doing the awkward math.",
    author: "Splito",
  },
  {
    quote:
      "The best group memories are priceless. The shared costs just need good notes.",
    author: "Splito",
  },
];

function showTip(tip) {
  $("#tipQuote").textContent = tip.quote;
  $("#tipAuthor").textContent = tip.author
    ? `— ${tip.author}`
    : "";
  $("#tipAttribution").hidden = tip.source !== "zenquotes";
}

async function refreshTip() {
  const request = ++tipRequest;
  showTip(
    localTips[Math.floor(Math.random() * localTips.length)],
  );
  try {
    const result = await api("/tip");
    if (request === tipRequest && result.tip)
      showTip(result.tip);
  } catch {
    // The locally selected tip remains visible if the quote service is unavailable.
  }
}

function activityPaginationMarkup() {
  const pagination = dash.activityPagination;
  if (!pagination || pagination.totalPages <= 1) return "";
  const start =
    (pagination.page - 1) * pagination.pageSize + 1;
  const end = Math.min(
    pagination.total,
    pagination.page * pagination.pageSize,
  );
  return `<div class="activity-pagination" aria-label="Activity pagination"><span>Showing ${start}-${end} of ${pagination.total}</span><span class="activity-pagination-actions"><button class="entry-button" type="button" data-activity-page="${pagination.page - 1}" ${pagination.page === 1 ? "disabled" : ""}>Previous</button><span>Page ${pagination.page} of ${pagination.totalPages}</span><button class="entry-button" type="button" data-activity-page="${pagination.page + 1}" ${pagination.page === pagination.totalPages ? "disabled" : ""}>Next</button></span></div>`;
}

function friendBalanceMarkup(person, index) {
  const balance = Number(person.balance_cents) || 0;
  const status =
    balance > 0
      ? `${esc(person.name)} owes you`
      : balance < 0
        ? `You owe ${esc(person.name)}`
        : "All settled up";
  const settleButton = balance
    ? `<button class="entry-button settle-friend-button" type="button" data-settle-friend="${person.id}">Settle</button>`
    : "";
  return `<div class="friend">${avatar(person, index)}<div class="friend-info"><strong>${esc(person.name)}</strong><small>${person.shared_group_count ? `${person.shared_group_count} shared group${person.shared_group_count === 1 ? "" : "s"}` : "No shared groups yet"}</small></div><div class="friend-balance ${balance < 0 ? "negative" : ""}"><small>${status}</small><b>${money(balance)}</b><span class="friend-actions">${settleButton}<button class="entry-button danger member-friend-button" type="button" data-unfriend="${person.id}">Unfriend</button></span></div></div>`;
}

function unsettledNonFriendMarkup(person, index) {
  const balance = Number(person.balance_cents) || 0;
  const status =
    balance > 0
      ? `${esc(person.name)} owes you`
      : `You owe ${esc(person.name)}`;
  return `<div class="friend">${avatar(person, index)}<div class="friend-info"><strong>${esc(person.name)}</strong><small>${person.shared_group_count} shared group${person.shared_group_count === 1 ? "" : "s"} · Not in your Friends list</small></div><div class="friend-balance ${balance < 0 ? "negative" : ""}"><small>${status}</small><b>${money(balance)}</b><span class="friend-actions"><button class="entry-button settle-friend-button" type="button" data-settle-friend="${person.id}">Settle</button><button class="entry-button member-friend-button" type="button" data-add-overview-friend="${person.id}">Add friend</button></span></div></div>`;
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
  const pagination = activityPaginationMarkup();
  $("#recentActivityPagination").innerHTML = pagination;
  $("#allActivityPagination").innerHTML = pagination;
  const people =
    (dash.friends || [])
      .map((person, index) =>
        friendBalanceMarkup(person, index),
      )
      .join("") ||
    "<p>Add friends to your account, then select them when adding members to a group.</p>";
  $("#friendList").innerHTML = people;
  $("#allFriends").innerHTML = people;
  const unsettledNonFriends =
    dash.unsettled_non_friends || [];
  $("#unsettledNonFriendsPanel").hidden =
    !unsettledNonFriends.length;
  $("#unsettledNonFriendsList").innerHTML =
    unsettledNonFriends
      .map((person, index) =>
        unsettledNonFriendMarkup(person, index),
      )
      .join("");
}

async function load() {
  dash = await api(
    `/dashboard?activityPage=${activityPage}&activityPageSize=8`,
  );
  activityPage = dash.activityPagination?.page || 1;
  render();
  refreshTip();
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
    .querySelectorAll(".nav-link, .mobile-nav [data-view]")
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
  const isGroupOwner =
    Number(group.created_by) === Number(me.id);
  $("#editGroupBtn").hidden = !isGroupOwner;
  $("#deleteGroupBtn").hidden = !isGroupOwner;
  $("#detailTitle").textContent =
    `${group.emoji} ${group.name}`;
  $("#detailOwner").textContent =
    `Group owner: ${group.owner_name || "Unknown"}`;
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
      return `<div class="friend">${avatar(person, index)}<div class="friend-info"><strong>${esc(person.name)}</strong><small>${person.balance_cents > 0 ? "is owed" : person.balance_cents < 0 ? "owes" : "is settled up"}</small></div><div class="friend-balance ${person.balance_cents < 0 ? "negative" : ""}"><b>${money(person.balance_cents)}</b>${friendAction}</div></div>`;
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
        const status = `<span class="invite-status ${completed ? "completed" : "pending"}">${completed ? "Completed" : "Pending"}</span>`;
        const actions = completed
          ? status
          : `<div class="invite-actions"><button class="entry-button" type="button" data-copy-invite="${invite.id}">Copy link</button>${status}</div>`;
        return `<div class="activity-item invite-item"><div class="expense-icon">&#x2709;&#xFE0F;</div><div class="activity-main"><strong>${esc(invite.email)}</strong><span>${completed ? "Accepted" : "Sent"} ${esc(date)}${invite.add_to_friends ? " - added to Friends on acceptance" : ""}</span></div>${actions}</div>`;
      })
      .join("") ||
    "<p>No invitations have been sent for this group.</p>";
  $("#detailExpenses").innerHTML =
    activeGroup.expenses
      .map((entry) => activityMarkup(entry, isGroupOwner))
      .join("") || "<p>No expenses in this group yet.</p>";
  $("#detailSettlements").innerHTML =
    activeGroup.settlements
      .map((entry) => settlementMarkup(entry, isGroupOwner))
      .join("") || "<p>No settlements yet.</p>";
  view("group");
}

async function refreshAfterMutation(groupId) {
  activityPage = 1;
  await load();
  await openGroup(groupId);
}

function isActiveGroupOwner() {
  return Boolean(
    activeGroup &&
    Number(activeGroup.group.created_by) === Number(me?.id),
  );
}

async function deleteGroup() {
  if (!isActiveGroupOwner())
    return toast(
      "Only the group owner can delete this group.",
    );
  const groupId = activeGroup.group.id;
  const groupName = activeGroup.group.name;
  if (
    !window.confirm(
      `Delete ${groupName}? All group expenses, settlements, and invitations will be permanently deleted.`,
    )
  )
    return;
  try {
    await api(`/groups/${groupId}`, { method: "DELETE" });
    activeGroup = undefined;
    await load();
    view("dashboard");
    toast(`${groupName} was deleted.`);
  } catch (error) {
    toast(error.message);
  }
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied)
    throw Error("Your browser could not copy the link.");
}

async function copyInviteLink(inviteId) {
  if (!activeGroup)
    return toast(
      "Open the group before copying its invite link.",
    );
  try {
    const result = await api(
      `/groups/${activeGroup.group.id}/invites/${inviteId}/link`,
    );
    await copyText(result.inviteUrl);
    toast("Invite link copied to your clipboard.");
  } catch (error) {
    toast(error.message);
  }
}

function openInviteLinkDialog(inviteUrl) {
  $("#generatedInviteLink").value = inviteUrl;
  openDialog($("#inviteLinkDialog"));
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

async function addOverviewPersonAsFriend(friendId) {
  const person = (dash.unsettled_non_friends || []).find(
    (nonFriend) => nonFriend.id === friendId,
  );
  if (!person)
    return toast(
      "That person no longer has an unsettled balance.",
    );
  try {
    const result = await api("/friends", {
      method: "POST",
      body: JSON.stringify({ email: person.email }),
    });
    await load();
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

function selectedExpenseParticipants() {
  return [...$("#expenseParticipants").selectedOptions]
    .map((option) => ({
      id: Number(option.value),
      name: option.textContent.trim(),
    }))
    .filter((person) => Number.isSafeInteger(person.id));
}

function expenseAmountCents() {
  const value = $("#expenseAmount").value;
  if (value.trim() === "") return null;
  const cents = Math.round(Number(value) * 100);
  return Number.isSafeInteger(cents) && cents > 0
    ? cents
    : null;
}

function equalExpenseSplitCents(cents, count) {
  if (!count) return [];
  const each = Math.floor(cents / count);
  const remainder = cents % count;
  return Array.from(
    { length: count },
    (_, index) => each + (index < remainder ? 1 : 0),
  );
}

function decimalValue(value) {
  if (String(value ?? "").trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function valueInCents(value, allowNegative = false) {
  const number = decimalValue(value);
  const cents =
    number === null ? null : Math.round(number * 100);
  return Number.isSafeInteger(cents) &&
    (allowNegative || cents >= 0)
    ? cents
    : null;
}

function defaultExpenseSplitValue(
  mode,
  index,
  count,
  cents,
) {
  if (mode === "exact") {
    if (!cents) return "";
    return (
      equalExpenseSplitCents(cents, count)[index] / 100
    ).toFixed(2);
  }
  if (mode === "percentage") {
    const base = Math.floor(10000 / count) / 100;
    const percentage =
      index === count - 1 ? 100 - base * (count - 1) : base;
    return String(Number(percentage.toFixed(2)));
  }
  if (mode === "shares") return "1";
  return "0.00";
}

function hasExpenseSplitValue(userId) {
  return Object.prototype.hasOwnProperty.call(
    expenseSplitValues,
    String(userId),
  );
}

function rememberExpenseSplitValues() {
  $$("#expenseSplitEditor [data-split-value]").forEach(
    (input) => {
      expenseSplitValues[input.dataset.splitValue] =
        input.value;
    },
  );
}

function splitModeDetails(mode) {
  return {
    exact: {
      label: "Amount (₹)",
      copy: "Enter the exact amount owed by each selected member. The amounts must equal the expense total.",
      input: 'min="0" step="0.01"',
    },
    percentage: {
      label: "Percentage (%)",
      copy: "Choose what percentage of the expense each selected member owes. Percentages must total 100%.",
      input: 'min="0" step="0.01"',
    },
    shares: {
      label: "Shares",
      copy: "Give each selected member a relative number of shares, such as 1, 2, or 3.",
      input: 'min="0.01" step="0.01"',
    },
    adjustment: {
      label: "Adjustment (₹)",
      copy: "Start with an equal split, then add or subtract an amount for each person. Adjustments must total ₹0.00.",
      input: 'step="0.01"',
    },
  }[mode];
}

function setExpenseSplitSummary(message, isError = false) {
  const summary = $("#expenseSplitSummary");
  if (!summary) return;
  summary.textContent = message;
  summary.classList.toggle("error", isError);
}

function refreshExpenseSplitSummary() {
  const mode = $("#expenseSplitMode").value;
  const participants = selectedExpenseParticipants();
  const cents = expenseAmountCents();
  if (!participants.length) {
    setExpenseSplitSummary(
      "Select at least one person to split with.",
      true,
    );
    return;
  }
  if (mode === "equal") {
    if (!cents) {
      setExpenseSplitSummary(
        "Enter an expense amount to calculate the split.",
      );
      return;
    }
    const amounts = equalExpenseSplitCents(
      cents,
      participants.length,
    );
    const uniqueAmounts = [...new Set(amounts)];
    const amountText = uniqueAmounts
      .map(money)
      .join(" and ");
    setExpenseSplitSummary(
      participants.length +
        " " +
        (participants.length === 1 ? "person" : "people") +
        " will owe " +
        amountText +
        " each.",
    );
    return;
  }
  const values = $$(
    "#expenseSplitEditor [data-split-value]",
  ).map((input) => input.value);
  if (values.length !== participants.length) return;
  if (mode === "exact") {
    const amounts = values.map((value) =>
      valueInCents(value),
    );
    const assigned = amounts.reduce(
      (total, amount) => total + (amount ?? 0),
      0,
    );
    if (!cents) {
      setExpenseSplitSummary(
        "Enter an expense amount to check this split.",
      );
      return;
    }
    const valid = amounts.every(
      (amount) => amount !== null,
    );
    setExpenseSplitSummary(
      "Assigned " +
        money(assigned) +
        " of " +
        money(cents) +
        ".",
      !valid || assigned !== cents,
    );
    return;
  }
  if (mode === "percentage") {
    const percentages = values.map(decimalValue);
    const total = percentages.reduce(
      (sum, percentage) => sum + (percentage ?? 0),
      0,
    );
    const valid = percentages.every(
      (percentage) =>
        percentage !== null && percentage >= 0,
    );
    setExpenseSplitSummary(
      "Percentage total: " +
        Number(total.toFixed(4)) +
        "% of 100%.",
      !valid || Math.abs(total - 100) > 0.000001,
    );
    return;
  }
  if (mode === "shares") {
    const shares = values.map(decimalValue);
    const total = shares.reduce(
      (sum, share) => sum + (share ?? 0),
      0,
    );
    const valid = shares.every(
      (share) => share !== null && share > 0,
    );
    setExpenseSplitSummary(
      "Total shares: " + Number(total.toFixed(4)) + ".",
      !valid,
    );
    return;
  }
  const adjustments = values.map((value) =>
    valueInCents(value, true),
  );
  const total = adjustments.reduce(
    (sum, adjustment) => sum + (adjustment ?? 0),
    0,
  );
  const equalAmounts = cents
    ? equalExpenseSplitCents(cents, participants.length)
    : [];
  const valid =
    adjustments.every(
      (adjustment) => adjustment !== null,
    ) &&
    adjustments.every(
      (adjustment, index) =>
        !cents || equalAmounts[index] + adjustment >= 0,
    );
  setExpenseSplitSummary(
    "Adjustments total: " + signedMoney(total) + ".",
    !valid || total !== 0,
  );
}

function renderExpenseSplitEditor() {
  const editor = $("#expenseSplitEditor");
  const mode = $("#expenseSplitMode").value;
  const participants = selectedExpenseParticipants();
  const cents = expenseAmountCents();
  editor.hidden = false;
  if (!participants.length) {
    editor.innerHTML =
      '<p class="split-editor-copy">Select people above to set up the split.</p><p class="split-summary" id="expenseSplitSummary"></p>';
    refreshExpenseSplitSummary();
    return;
  }
  if (mode === "equal") {
    editor.innerHTML =
      '<p class="split-editor-copy">The expense is divided evenly between the selected people. Any one-paise rounding difference is shared fairly.</p><p class="split-summary" id="expenseSplitSummary"></p>';
    refreshExpenseSplitSummary();
    return;
  }
  const details = splitModeDetails(mode);
  const rows = participants
    .map((person, index) => {
      const value = hasExpenseSplitValue(person.id)
        ? expenseSplitValues[String(person.id)]
        : defaultExpenseSplitValue(
            mode,
            index,
            participants.length,
            cents,
          );
      return (
        '<label class="split-row"><strong>' +
        esc(person.name) +
        '</strong><input type="number" aria-label="' +
        esc(details.label) +
        " for " +
        esc(person.name) +
        '" data-split-value="' +
        person.id +
        '" value="' +
        esc(value) +
        '" ' +
        details.input +
        "></label>"
      );
    })
    .join("");
  editor.innerHTML =
    '<p class="split-editor-copy">' +
    esc(details.copy) +
    "</p>" +
    rows +
    '<p class="split-summary" id="expenseSplitSummary"></p>';
  refreshExpenseSplitSummary();
}

function expenseSplitPayload() {
  const cents = expenseAmountCents();
  const participants = selectedExpenseParticipants();
  const mode = $("#expenseSplitMode").value;
  if (!cents)
    return { error: "Enter a valid expense amount." };
  if (!participants.length)
    return {
      error: "Select at least one person to split with.",
    };
  if (mode === "equal") return { mode, splits: [] };
  const values = $$(
    "#expenseSplitEditor [data-split-value]",
  ).map((input) => input.value);
  if (values.length !== participants.length)
    return {
      error:
        "Enter a split value for every selected member.",
    };
  if (mode === "exact") {
    const amounts = values.map((value) =>
      valueInCents(value),
    );
    if (
      amounts.some((amount) => amount === null) ||
      amounts.reduce(
        (total, amount) => total + amount,
        0,
      ) !== cents
    )
      return {
        error:
          "Exact split amounts must add up to the expense total.",
      };
  } else if (mode === "percentage") {
    const percentages = values.map(decimalValue);
    const total = percentages.reduce(
      (sum, percentage) => sum + (percentage ?? 0),
      0,
    );
    if (
      percentages.some(
        (percentage) =>
          percentage === null || percentage < 0,
      ) ||
      Math.abs(total - 100) > 0.000001
    )
      return {
        error: "Split percentages must add up to 100%.",
      };
  } else if (mode === "shares") {
    const shares = values.map(decimalValue);
    if (
      shares.some((share) => share === null || share <= 0)
    )
      return {
        error:
          "Each selected member needs a positive number of shares.",
      };
  } else {
    const adjustments = values.map((value) =>
      valueInCents(value, true),
    );
    const equalAmounts = equalExpenseSplitCents(
      cents,
      participants.length,
    );
    if (
      adjustments.some(
        (adjustment) => adjustment === null,
      ) ||
      adjustments.reduce(
        (total, adjustment) => total + adjustment,
        0,
      ) !== 0
    )
      return {
        error: "Split adjustments must add up to ₹0.00.",
      };
    if (
      adjustments.some(
        (adjustment, index) =>
          equalAmounts[index] + adjustment < 0,
      )
    )
      return {
        error:
          "An adjustment cannot make a member's share negative.",
      };
  }
  return {
    mode,
    splits: participants.map((person, index) => ({
      userId: person.id,
      value: values[index],
    })),
  };
}

function initializeExpenseSplitEditor(entry) {
  expenseSplitValues = {};
  const splits = entry?.splits || [];
  const splitCents = splits.map((split) =>
    Number(split.amount_cents),
  );
  const total = splitCents.reduce(
    (sum, amount) => sum + amount,
    0,
  );
  const isEqual =
    splitCents.length > 0 &&
    splitCents.every(Number.isSafeInteger) &&
    total === entry?.amount_cents &&
    Math.max(...splitCents) - Math.min(...splitCents) <= 1;
  const storedMode = [
    "equal",
    "exact",
    "percentage",
    "shares",
    "adjustment",
  ].includes(entry?.split_method)
    ? entry.split_method
    : isEqual
      ? "equal"
      : "exact";
  $("#expenseSplitMode").value = storedMode;
  if (entry && storedMode !== "equal") {
    const equalAmounts = equalExpenseSplitCents(
      entry.amount_cents,
      splits.length,
    );
    expenseSplitValues = Object.fromEntries(
      splits.map((split, index) => {
        const cents = Number(split.amount_cents);
        const value =
          storedMode === "percentage"
            ? ((cents / entry.amount_cents) * 100).toFixed(
                6,
              )
            : storedMode === "adjustment"
              ? (
                  (cents - equalAmounts[index]) /
                  100
                ).toFixed(2)
              : storedMode === "shares"
                ? String(cents)
                : (cents / 100).toFixed(2);
        return [String(split.user_id), value];
      }),
    );
  }
  renderExpenseSplitEditor();
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
  renderExpenseSplitEditor();
}

async function openExpense(entry) {
  if (!dash.groups.length)
    return toast("Create a group first.");
  const form = $("#expenseForm");
  const groupSelect = $("#expenseGroup");
  form.reset();
  expenseReceiptImage = entry?.receipt_image || "";
  $("#expenseReceipt").value = "";
  updateReceiptPreview("expense");
  setExpenseEmojiPicker(false);
  expenseSplitValues = {};
  $("#expenseSplitMode").value = "equal";
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
  const legacyDescription = entry?.emoji
    ? { emoji: entry.emoji, text: entry.description }
    : emojiAndTextFromDescription(entry?.description);
  form.elements.emoji.value = entry
    ? legacyDescription.emoji
    : "✨";
  form.elements.description.value = entry
    ? legacyDescription.text
    : "";
  form.elements.amount.value = entry
    ? (entry.amount_cents / 100).toFixed(2)
    : "";
  form.elements.date.value = entry?.expense_date || today();
  form.elements.category.value = entry?.category || "other";
  form.elements.notes.value = entry?.notes || "";
  groupSelect.onchange = () => {
    expenseSplitValues = {};
    $("#expenseSplitMode").value = "equal";
    populateExpenseMembers(groupSelect.value).catch(
      (error) => toast(error.message),
    );
  };
  await populateExpenseMembers(
    groupId,
    entry?.splits?.map((split) => split.user_id),
    entry?.paid_by || me.id,
  );
  initializeExpenseSplitEditor(entry);
  openDialog($("#expenseDialog"));
}

function openGroupDialog(group) {
  const form = $("#groupForm");
  form.reset();
  form.elements.groupId.value = group?.id || "";
  form.elements.name.value = group?.name || "";
  form.elements.emoji.value = group?.emoji || "";
  setGroupEmojiPicker(false);
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

function setGroupEmojiPicker(isOpen) {
  $("#groupEmojiPicker").hidden = !isOpen;
}

function chooseGroupEmoji(emoji) {
  const input = $("#groupEmoji");
  input.value = emoji;
  input.focus();
  setGroupEmojiPicker(false);
}

function setExpenseEmojiPicker(isOpen) {
  $("#expenseEmojiPicker").hidden = !isOpen;
}

function chooseExpenseEmoji(emoji) {
  const input = $("#expenseEmoji");
  input.value = emoji;
  input.focus();
  setExpenseEmojiPicker(false);
}

function setAccountAvatarEmojiPicker(isOpen) {
  $("#accountAvatarEmojiPicker").hidden = !isOpen;
}

function updateAccountAvatarPreview() {
  const form = $("#accountForm");
  applyAvatar($("#accountAvatarPreview"), {
    name: form.elements.name.value || me.name,
    avatar_emoji: form.elements.avatarEmoji.value,
    avatar_image: accountAvatarImage,
    avatar_color: form.elements.avatarColor.value,
  });
}

function updateAccountAvatarColorButtons() {
  const color =
    $("#accountForm").elements.avatarColor.value;
  $("#accountAvatarColorPicker").value = color;
  $$("[data-account-avatar-color]").forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.accountAvatarColor === color),
    );
  });
}

function chooseAccountAvatarColor(color) {
  $("#accountForm").elements.avatarColor.value =
    String(color).toLowerCase();
  updateAccountAvatarColorButtons();
  updateAccountAvatarPreview();
}

function chooseAccountAvatarEmoji(emoji) {
  $("#accountAvatarEmoji").value = emoji;
  updateAccountAvatarPreview();
  setAccountAvatarEmojiPicker(false);
}

function imageForAccountAvatar(file) {
  if (!file)
    return Promise.reject(
      Error("Choose a JPG, PNG, or WebP profile image."),
    );
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(
      file.type,
    )
  )
    return Promise.reject(
      Error("Choose a JPG, PNG, or WebP profile image."),
    );
  if (file.size > 5 * 1024 * 1024)
    return Promise.reject(
      Error("Choose a profile image smaller than 5 MB."),
    );
  const objectUrl = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const largestSide = 256;
      const scale = Math.min(
        1,
        largestSide /
          Math.max(image.naturalWidth, image.naturalHeight),
      );
      const width = Math.max(
        1,
        Math.round(image.naturalWidth * scale),
      );
      const height = Math.max(
        1,
        Math.round(image.naturalHeight * scale),
      );
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      let dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      if (dataUrl.length > 180000)
        dataUrl = canvas.toDataURL("image/jpeg", 0.65);
      if (dataUrl.length > 180000) {
        reject(
          Error(
            "This image is too detailed to save. Choose a simpler photo.",
          ),
        );
        return;
      }
      resolve(dataUrl);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(
        Error("The selected image could not be read."),
      );
    };
    image.src = objectUrl;
  });
}

function receiptImageBytes(dataUrl) {
  const encoded = String(dataUrl || "").split(",")[1] || "";
  const padding = encoded.endsWith("==")
    ? 2
    : encoded.endsWith("=")
      ? 1
      : 0;
  return (encoded.length * 3) / 4 - padding;
}

function receiptImageSizeLabel(dataUrl) {
  return `${Math.max(1, Math.ceil(receiptImageBytes(dataUrl) / 1024))} KB`;
}

function imageForReceipt(file) {
  if (!file)
    return Promise.reject(
      Error("Choose a JPG, PNG, or WebP receipt image."),
    );
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(
      file.type,
    )
  )
    return Promise.reject(
      Error("Choose a JPG, PNG, or WebP receipt image."),
    );
  if (file.size > 12 * 1024 * 1024)
    return Promise.reject(
      Error("Choose a receipt image smaller than 12 MB."),
    );
  const objectUrl = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const largestSide = 1600;
      const baseScale = Math.min(
        1,
        largestSide /
          Math.max(image.naturalWidth, image.naturalHeight),
      );
      const baseWidth = Math.max(
        1,
        Math.round(image.naturalWidth * baseScale),
      );
      const baseHeight = Math.max(
        1,
        Math.round(image.naturalHeight * baseScale),
      );
      for (const scale of [1, 0.85, 0.7, 0.55, 0.4]) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(
          1,
          Math.round(baseWidth * scale),
        );
        canvas.height = Math.max(
          1,
          Math.round(baseHeight * scale),
        );
        const context = canvas.getContext("2d");
        if (!context) continue;
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(
          image,
          0,
          0,
          canvas.width,
          canvas.height,
        );
        for (const quality of [0.82, 0.72, 0.62, 0.52]) {
          const dataUrl = canvas.toDataURL(
            "image/jpeg",
            quality,
          );
          if (
            receiptImageBytes(dataUrl) <=
            maxReceiptImageBytes
          ) {
            resolve(dataUrl);
            return;
          }
        }
      }
      reject(
        Error(
          "This receipt image is too detailed to compress below 500 KB. Choose a simpler image.",
        ),
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(
        Error(
          "The selected receipt image could not be read.",
        ),
      );
    };
    image.src = objectUrl;
  });
}

function receiptImageFor(kind) {
  return kind === "expense"
    ? expenseReceiptImage
    : settlementReceiptImage;
}

function setReceiptImage(kind, dataUrl) {
  if (kind === "expense") expenseReceiptImage = dataUrl;
  else settlementReceiptImage = dataUrl;
}

function updateReceiptPreview(kind) {
  const dataUrl = receiptImageFor(kind);
  const preview = $(`#${kind}ReceiptPreview`);
  preview.hidden = !dataUrl;
  $(`#${kind}ReceiptPreviewImage`).src = dataUrl || "";
  $(`#${kind}ReceiptStatus`).textContent = dataUrl
    ? `Receipt ready (${receiptImageSizeLabel(dataUrl)}). It will be saved under the 500 KB limit.`
    : "JPG, PNG, or WebP. It is compressed to a JPEG under 500 KB before saving.";
}

async function chooseReceiptImage(kind, input) {
  try {
    const dataUrl = await imageForReceipt(input.files[0]);
    setReceiptImage(kind, dataUrl);
    updateReceiptPreview(kind);
    toast("Receipt ready to save.");
  } catch (error) {
    input.value = "";
    toast(error.message);
  }
}

function removeReceiptImage(kind) {
  setReceiptImage(kind, "");
  $(`#${kind}Receipt`).value = "";
  updateReceiptPreview(kind);
}

const groupEmojiOptions = [
  "✨",
  "🎉",
  "🎊",
  "🎈",
  "🎂",
  "🎁",
  "❤️",
  "💛",
  "💚",
  "💙",
  "💜",
  "⭐",
  "🌈",
  "🔥",
  "✈️",
  "🚗",
  "🚙",
  "🚕",
  "🚌",
  "🚆",
  "🚇",
  "🚲",
  "🛵",
  "🚤",
  "⛵",
  "🛳️",
  "🚢",
  "⛺",
  "🏕️",
  "🏖️",
  "🏝️",
  "🗺️",
  "🧳",
  "🧭",
  "🍽️",
  "🍕",
  "🍔",
  "🍟",
  "🌮",
  "🌯",
  "🍣",
  "🍜",
  "🍛",
  "🍝",
  "🥗",
  "🍗",
  "🍰",
  "🧁",
  "🍩",
  "🍪",
  "☕",
  "🍵",
  "🍺",
  "🍷",
  "🍹",
  "🥂",
  "🏠",
  "🏡",
  "🏢",
  "🏨",
  "🏰",
  "🛋️",
  "🛏️",
  "🪴",
  "🧹",
  "🔑",
  "🧺",
  "🧼",
  "🪑",
  "🚪",
  "🏗️",
  "👥",
  "💬",
  "📸",
  "🎵",
  "🎤",
  "🎧",
  "🎬",
  "🎭",
  "🎨",
  "🎮",
  "🎲",
  "🎯",
  "⚽",
  "🏏",
  "🏸",
  "🏋️",
  "🤸",
  "🧘",
  "🏊",
  "🚴",
  "🏃",
  "💼",
  "📚",
  "📝",
  "💻",
  "🖥️",
  "📱",
  "🧪",
  "🔬",
  "🛠️",
  "📈",
  "📊",
  "🗓️",
  "💡",
  "💸",
  "💰",
  "🪙",
  "🧾",
  "🛒",
  "🎟️",
  "🏷️",
  "🌿",
  "🍀",
  "🌻",
  "🌸",
  "🌲",
  "⛰️",
  "🌙",
  "☀️",
  "❄️",
  "🍂",
  "🐾",
  "🐶",
  "🐱",
  "🇮🇳",
];

function renderEmojiPicker(pickerSelector, emojiAttribute) {
  const picker = $(pickerSelector);
  picker.innerHTML = [...new Set(groupEmojiOptions)]
    .map(
      (emoji) =>
        `<button type="button" ${emojiAttribute}="${esc(emoji)}" aria-label="Use ${esc(emoji)}">${esc(emoji)}</button>`,
    )
    .join("");
}

function updateSettlementFriendBalance(autoFill = false) {
  const payerId = Number($("#settlePayer").value);
  const payeeId = Number($("#settlePayee").value);
  const currentUserId = Number(me.id);
  const friendId =
    payerId === currentUserId
      ? payeeId
      : payeeId === currentUserId
        ? payerId
        : null;
  const friend = (dash.friends || []).find(
    (person) => Number(person.id) === friendId,
  );
  const balance = Number(friend?.balance_cents) || 0;
  const isPaymentInOwedDirection =
    (payerId === currentUserId &&
      payeeId === Number(friend?.id) &&
      balance < 0) ||
    (payerId === Number(friend?.id) &&
      payeeId === currentUserId &&
      balance > 0);
  const context = $("#settleContext");

  if (!friend || !balance || !isPaymentInOwedDirection) {
    context.hidden = true;
    return;
  }

  const amount = money(balance);
  context.hidden = false;
  context.textContent =
    balance < 0
      ? `You owe ${friend.name} ${amount} across your shared groups. The amount is filled in; change it for a partial payment.`
      : `${friend.name} owes you ${amount} across your shared groups. The amount is filled in; change it for a partial payment.`;
  if (autoFill) {
    $("#settleForm").elements.amount.value = (
      Math.abs(balance) / 100
    ).toFixed(2);
  }
}

async function populateSettlementMembers(
  groupId,
  selected = {},
  {
    showFriendBalance = false,
    autoFillBalance = false,
  } = {},
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
  const refreshFriendBalance = () => {
    if (showFriendBalance)
      updateSettlementFriendBalance(autoFillBalance);
  };
  payer.onchange = () => {
    setPayees();
    refreshFriendBalance();
  };
  payee.onchange = refreshFriendBalance;
  setPayees();
  refreshFriendBalance();
}

function sharedGroupsForFriend(friend) {
  const groupIds = new Set(
    String(friend.shared_group_ids || "")
      .split(",")
      .map(Number)
      .filter(Number.isSafeInteger),
  );
  return (dash.groups || []).filter((group) =>
    groupIds.has(Number(group.id)),
  );
}

async function openSettlement(entry, directFriend) {
  if (!dash.groups.length)
    return toast("Create a group first.");
  const directBalance =
    Number(directFriend?.balance_cents) || 0;
  if (directFriend && !directBalance)
    return toast(
      `You and ${directFriend.name} are settled up.`,
    );
  const settlementGroups = directFriend
    ? sharedGroupsForFriend(directFriend)
    : dash.groups;
  if (!settlementGroups.length)
    return toast(
      `You need a shared group with ${directFriend.name} to record this payment.`,
    );
  const form = $("#settleForm");
  const groupSelect = $("#settleGroup");
  form.reset();
  settlementReceiptImage = entry?.receipt_image || "";
  $("#settlementReceipt").value = "";
  updateReceiptPreview("settlement");
  form.elements.entryId.value = entry?.id || "";
  $("#settleDialogEyebrow").textContent = entry
    ? "EDIT SETTLEMENT"
    : directFriend
      ? "SETTLE WITH A FRIEND"
      : "SETTLE A BALANCE";
  $("#settleDialogTitle").textContent = entry
    ? "Edit payment"
    : directFriend
      ? `Settle with ${directFriend.name}`
      : "Record a payment";
  $("#settleSubmit").textContent = entry
    ? "Save changes"
    : "Record payment";
  groupSelect.disabled = Boolean(entry);
  groupSelect.innerHTML = settlementGroups
    .map(
      (group) =>
        `<option value="${group.id}">${esc(group.emoji)} ${esc(group.name)}</option>`,
    )
    .join("");
  const selected = entry
    ? { paidBy: entry.paid_by, paidTo: entry.paid_to }
    : directFriend
      ? directBalance > 0
        ? { paidBy: directFriend.id, paidTo: me.id }
        : { paidBy: me.id, paidTo: directFriend.id }
      : { paidBy: me.id };
  const groupId =
    entry?.group_id ||
    (settlementGroups.some(
      (group) =>
        Number(group.id) === Number(activeGroup?.group.id),
    )
      ? activeGroup?.group.id
      : settlementGroups[0].id);
  groupSelect.value = groupId;
  form.elements.amount.value = entry
    ? (entry.amount_cents / 100).toFixed(2)
    : directFriend
      ? (Math.abs(directBalance) / 100).toFixed(2)
      : "";
  form.elements.settledAt.value =
    entry?.settled_at?.slice(0, 10) || today();
  const showFriendBalance = !entry && !directFriend;
  groupSelect.onchange = () =>
    populateSettlementMembers(groupSelect.value, selected, {
      showFriendBalance,
      autoFillBalance: showFriendBalance,
    });
  $("#settleContext").hidden = !directFriend;
  if (directFriend)
    $("#settleContext").textContent =
      directBalance > 0
        ? `${directFriend.name} owes you ${money(directBalance)}. Choose the shared group for this payment.`
        : `You owe ${directFriend.name} ${money(directBalance)}. Choose the shared group for this payment.`;
  await populateSettlementMembers(groupId, selected, {
    showFriendBalance,
    autoFillBalance: showFriendBalance,
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

function openAccountSettings() {
  const form = $("#accountForm");
  form.reset();
  form.elements.name.value = me.name;
  form.elements.email.value = me.email;
  form.elements.avatarEmoji.value = me.avatar_emoji || "";
  form.elements.avatarColor.value =
    me.avatar_color || defaultAvatarColor;
  accountAvatarImage = me.avatar_image || "";
  $("#accountAvatarImage").value = "";
  setAccountAvatarEmojiPicker(false);
  updateAccountAvatarColorButtons();
  updateAccountAvatarPreview();
  updateEmailVerificationUI();
  openDialog($("#accountDialog"));
}

function signOut() {
  localStorage.removeItem("splito-token");
  location.reload();
}

function showGroups() {
  view("dashboard");
  requestAnimationFrame(() =>
    $("#groupsGrid").scrollIntoView({
      behavior: "smooth",
      block: "start",
    }),
  );
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

async function verifyEmailFromUrl() {
  const verificationToken = new URLSearchParams(
    location.search,
  ).get("verify");
  if (!verificationToken) return "";
  try {
    const result = await api("/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token: verificationToken }),
    });
    history.replaceState({}, "", location.pathname);
    return result.message;
  } catch (error) {
    history.replaceState({}, "", location.pathname);
    return error.message;
  }
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
  const submittedMode = mode;
  try {
    const result = await api(`/auth/${submittedMode}`, {
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
    updateAccountUI();
    await load();
    showSignedInApp();
    if (submittedMode === "register" && result.message) {
      toast(result.message);
    }
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

$("#resendVerificationBtn").onclick = async () => {
  try {
    const result = await api("/auth/resend-verification", {
      method: "POST",
    });
    toast(result.message);
  } catch (error) {
    toast(error.message);
  }
};

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

renderEmojiPicker("#groupEmojiPicker", "data-group-emoji");
renderEmojiPicker(
  "#expenseEmojiPicker",
  "data-expense-emoji",
);
renderEmojiPicker(
  "#accountAvatarEmojiPicker",
  "data-account-avatar-emoji",
);
const groupEmojiInput = $("#groupEmoji");
groupEmojiInput.onfocus = () => setGroupEmojiPicker(true);
groupEmojiInput.onclick = () => setGroupEmojiPicker(true);
const expenseEmojiInput = $("#expenseEmoji");
expenseEmojiInput.onfocus = () =>
  setExpenseEmojiPicker(true);
expenseEmojiInput.onclick = () =>
  setExpenseEmojiPicker(true);
const accountAvatarEmojiInput = $("#accountAvatarEmoji");
accountAvatarEmojiInput.onfocus = () =>
  setAccountAvatarEmojiPicker(true);
accountAvatarEmojiInput.onclick = () =>
  setAccountAvatarEmojiPicker(true);
$("#accountAvatarColorPicker").oninput = (event) =>
  chooseAccountAvatarColor(event.currentTarget.value);
$("#accountForm").elements.name.oninput =
  updateAccountAvatarPreview;
$("#accountAvatarImage").onchange = async (event) => {
  const input = event.currentTarget;
  try {
    accountAvatarImage = await imageForAccountAvatar(
      input.files[0],
    );
    updateAccountAvatarPreview();
    toast("Profile photo ready to save.");
  } catch (error) {
    input.value = "";
    toast(error.message);
  }
};
$("#removeAccountAvatarImageBtn").onclick = () => {
  accountAvatarImage = "";
  $("#accountAvatarImage").value = "";
  updateAccountAvatarPreview();
};
$("#expenseReceipt").onchange = (event) =>
  chooseReceiptImage("expense", event.currentTarget);
$("#settlementReceipt").onchange = (event) =>
  chooseReceiptImage("settlement", event.currentTarget);
$("#removeExpenseReceipt").onclick = () =>
  removeReceiptImage("expense");
$("#removeSettlementReceipt").onclick = () =>
  removeReceiptImage("settlement");
$("#expenseParticipants").onchange = () => {
  rememberExpenseSplitValues();
  renderExpenseSplitEditor();
};
$("#expenseSplitMode").onchange = () => {
  expenseSplitValues = {};
  renderExpenseSplitEditor();
};
$("#expenseAmount").oninput = () => {
  if (
    $("#expenseSplitMode").value === "exact" &&
    !Object.keys(expenseSplitValues).length
  ) {
    renderExpenseSplitEditor();
    return;
  }
  refreshExpenseSplitSummary();
};
$("#expenseSplitEditor").oninput = (event) => {
  if (!event.target.matches("[data-split-value]")) return;
  expenseSplitValues[event.target.dataset.splitValue] =
    event.target.value;
  refreshExpenseSplitSummary();
};
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".emoji-control")) {
    setGroupEmojiPicker(false);
    setExpenseEmojiPicker(false);
    setAccountAvatarEmojiPicker(false);
  }
});

$("#newGroupBtn").onclick = () => openGroupDialog();
$("#mobileNewGroupBtn").onclick = () => openGroupDialog();
$("#accountSettingsBtn").onclick = openAccountSettings;
$("#mobileAccountSettingsBtn").onclick =
  openAccountSettings;
$("#mobileAccountNavBtn").onclick = openAccountSettings;
$("#accountDialogLogoutBtn").onclick = signOut;
$("#compactGroupsBtn").onclick = showGroups;
$("#mobileGroupsBtn").onclick = showGroups;
$("#editGroupBtn").onclick = () =>
  isActiveGroupOwner() &&
  openGroupDialog(activeGroup.group);
$("#deleteGroupBtn").onclick = deleteGroup;
$("#copyGeneratedInviteLinkBtn").onclick = async () => {
  try {
    await copyText($("#generatedInviteLink").value);
    toast("Invite link copied to your clipboard.");
  } catch (error) {
    toast(error.message);
  }
};
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
  if (groupId && !isActiveGroupOwner()) {
    toast("Only the group owner can edit this group.");
    return;
  }
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
        avatarEmoji: fields.get("avatarEmoji"),
        avatarImage: accountAvatarImage,
        avatarColor: fields.get("avatarColor"),
      }),
    });
    token = result.token;
    me = result.user;
    accountAvatarImage = me.avatar_image || "";
    localStorage.setItem("splito-token", token);
    updateAccountUI();
    closeDialog($("#accountDialog"));
    const groupId = activeGroup?.group.id;
    await load();
    if (groupId) await openGroup(groupId);
    toast(
      result.user.email_verified_at
        ? "Account settings saved"
        : "Account settings saved. Verify your new email before sending invitations.",
    );
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
  const split = expenseSplitPayload();
  if (split.error) {
    toast(split.error);
    return;
  }
  try {
    await api(
      entryId
        ? `/expenses/${entryId}`
        : `/groups/${groupId}/expenses`,
      {
        method: entryId ? "PUT" : "POST",
        body: JSON.stringify({
          description: fields.get("description"),
          emoji: fields.get("emoji"),
          amount: fields.get("amount"),
          paidBy: fields.get("payer"),
          participants: fields.getAll("participants"),
          splitMode: split.mode,
          splits: split.splits,
          date: fields.get("date"),
          category: fields.get("category"),
          notes: fields.get("notes"),
          receiptImage: expenseReceiptImage,
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
          receiptImage: settlementReceiptImage,
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
    if (result.debugInviteUrl)
      openInviteLinkDialog(result.debugInviteUrl);
    else toast(`Invitation email sent to ${result.email}.`);
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
    ["expenses", "settlements"].includes(type) &&
    !isActiveGroupOwner()
  )
    return toast(
      `Only the group owner can delete ${label}s.`,
    );
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

$("#logoutBtn").onclick = signOut;
$("#backToDashboard").onclick = () => view("dashboard");
$("#seeGroups").onclick = showGroups;

document.addEventListener("click", (event) => {
  const groupEmoji = event.target.closest(
    "[data-group-emoji]",
  );
  const expenseEmoji = event.target.closest(
    "[data-expense-emoji]",
  );
  const accountAvatarEmoji = event.target.closest(
    "[data-account-avatar-emoji]",
  );
  const accountAvatarColor = event.target.closest(
    "[data-account-avatar-color]",
  );
  const activityPageButton = event.target.closest(
    "[data-activity-page]",
  );
  const addFriend = event.target.closest(
    "[data-add-friend]",
  );
  const addOverviewFriend = event.target.closest(
    "[data-add-overview-friend]",
  );
  const unfriendButton = event.target.closest(
    "[data-unfriend]",
  );
  const settleFriend = event.target.closest(
    "[data-settle-friend]",
  );
  const editExpense = event.target.closest(
    "[data-edit-expense]",
  );
  const deleteExpense = event.target.closest(
    "[data-delete-expense]",
  );
  const copyInvite = event.target.closest(
    "[data-copy-invite]",
  );
  const editSettlement = event.target.closest(
    "[data-edit-settlement]",
  );
  const deleteSettlement = event.target.closest(
    "[data-delete-settlement]",
  );
  if (groupEmoji)
    return chooseGroupEmoji(groupEmoji.dataset.groupEmoji);
  if (expenseEmoji)
    return chooseExpenseEmoji(
      expenseEmoji.dataset.expenseEmoji,
    );
  if (accountAvatarEmoji)
    return chooseAccountAvatarEmoji(
      accountAvatarEmoji.dataset.accountAvatarEmoji,
    );
  if (accountAvatarColor)
    return chooseAccountAvatarColor(
      accountAvatarColor.dataset.accountAvatarColor,
    );
  if (activityPageButton) {
    const page = Number(
      activityPageButton.dataset.activityPage,
    );
    if (
      Number.isSafeInteger(page) &&
      page > 0 &&
      page !== activityPage
    ) {
      activityPage = page;
      load().catch((error) => toast(error.message));
    }
    return;
  }
  if (addFriend)
    return addGroupMemberAsFriend(
      Number(addFriend.dataset.addFriend),
    );
  if (addOverviewFriend)
    return addOverviewPersonAsFriend(
      Number(addOverviewFriend.dataset.addOverviewFriend),
    );
  if (unfriendButton)
    return unfriend(
      Number(unfriendButton.dataset.unfriend),
    );
  if (settleFriend) {
    const friend = [
      ...(dash.friends || []),
      ...(dash.unsettled_non_friends || []),
    ].find(
      (person) =>
        person.id ===
        Number(settleFriend.dataset.settleFriend),
    );
    if (friend)
      openSettlement(null, friend).catch((error) =>
        toast(error.message),
      );
    return;
  }
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
  if (copyInvite)
    return copyInviteLink(
      Number(copyInvite.dataset.copyInvite),
    );
  if (editSettlement) {
    if (!isActiveGroupOwner())
      return toast(
        "Only the group owner can edit settlements.",
      );
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
  const emailVerificationMessage =
    await verifyEmailFromUrl();
  openResetFromUrl();
  if (!token) {
    showAuthenticationScreen();
    if (emailVerificationMessage)
      toast(emailVerificationMessage);
    return;
  }
  try {
    me = (await api("/me")).user;
    updateAccountUI();
    await load();
    showSignedInApp();
    if (emailVerificationMessage)
      toast(emailVerificationMessage);
    await acceptInvite();
  } catch {
    localStorage.removeItem("splito-token");
    showAuthenticationScreen();
    if (emailVerificationMessage)
      toast(emailVerificationMessage);
  }
})();
