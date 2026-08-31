// ---- State & helpers ----

async function api(path, options) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

function $(id) {
  return document.getElementById(id);
}

// ---- Setup screen ----

async function checkSetup() {
  const { config } = await api("/setup");
  if (config) {
    showConfiguredUI();
  } else {
    $("setup-screen").classList.remove("hidden");
  }
}

$("setup-submit").addEventListener("click", async () => {
  const username = $("username-input").value.trim();
  const leagueName = $("league-name-input").value.trim();
  const errorEl = $("setup-error");
  errorEl.classList.add("hidden");

  if (!username || !leagueName) {
    errorEl.textContent = "Enter both a username and a league name.";
    errorEl.classList.remove("hidden");
    return;
  }

  try {
    await api("/setup", { method: "POST", body: JSON.stringify({ username, leagueName }) });
    showConfiguredUI();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
  }
});

function showConfiguredUI() {
  $("setup-screen").classList.add("hidden");
  $("tabs").classList.remove("hidden");
  $("lineup-screen").classList.remove("hidden");
  loadLineup();
  loadTrends();
  loadSettings();
  checkPushStatus();
}

// ---- Tabs ----

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    ["lineup", "trends", "settings"].forEach((name) => {
      $(`${name}-screen`).classList.toggle("hidden", name !== btn.dataset.tab);
    });
  });
});

// ---- Lineup screen ----

async function loadLineup() {
  const { week, lineup } = await api("/lineup");
  $("lineup-week-title").textContent = `Week ${week} — optimal lineup`;
  const list = $("lineup-list");
  list.innerHTML = "";

  if (lineup.length === 0) {
    list.innerHTML = "<p class='subtle'>No lineup computed yet. Tap refresh, or check back after your league syncs.</p>";
    return;
  }

  for (const slot of lineup) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${slot.slotLabel}: ${slot.player ? slot.player.name : "— empty —"}</h3>
      <p>${slot.reasoning}</p>
    `;
    list.appendChild(card);
  }
}

$("lineup-refresh").addEventListener("click", async () => {
  $("lineup-refresh").textContent = "Refreshing...";
  try {
    await api("/lineup/refresh", { method: "POST" });
    await loadLineup();
  } finally {
    $("lineup-refresh").textContent = "Refresh";
  }
});

// ---- Trends screen ----

const TRIGGER_LABELS = {
  HOT_STREAK: "Hot streak",
  TARGET_SHARE_SPIKE: "Target share spike",
  SNAP_COUNT_JUMP: "Snap count jump"
};

async function loadTrends() {
  const { alerts } = await api("/trends");
  const list = $("trends-list");
  list.innerHTML = "";

  if (alerts.length === 0) {
    list.innerHTML = "<p class='subtle'>No alerts yet this season. Check back after games process on Tuesday.</p>";
    return;
  }

  for (const alert of alerts) {
    const ownershipText =
      alert.ownership.kind === "FREE_AGENT" ? "Free agent" : `On ${alert.ownership.managerName}'s bench`;
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${alert.playerName} — ${TRIGGER_LABELS[alert.triggerType] ?? alert.triggerType}</h3>
      <p>${alert.detail}</p>
      <p>${ownershipText} · Week ${alert.week} · ${new Date(alert.firedAtEpochMillis).toLocaleString()}</p>
    `;
    list.appendChild(card);
  }
}

// ---- Settings screen ----

const SLIDER_FIELDS = [
  ["reminder-hours", "lineupReminderHoursBeforeLock", (v) => v.toFixed(0)],
  ["streak-games", "hotStreakMinGames", (v) => v.toFixed(0)],
  ["streak-points", "hotStreakMinPoints", (v) => v.toFixed(1)],
  ["ts-multiplier", "targetShareSpikeMultiplier", (v) => v.toFixed(1)],
  ["ts-jump", "targetShareMinJumpPct", (v) => v.toFixed(0)],
  ["sc-multiplier", "snapCountSpikeMultiplier", (v) => v.toFixed(1)],
  ["sc-jump", "snapCountMinJumpPct", (v) => v.toFixed(0)]
  ["swap-edge", "swapAlertMinPointsEdge", (v) => v.toFixed(1)]
];

async function loadSettings() {
  const settings = await api("/settings");
  for (const [elId, key, fmt] of SLIDER_FIELDS) {
    const input = $(elId);
    input.value = settings[key];
    $(`${elId}-out`).textContent = fmt(settings[key]);
  }
}

for (const [elId, , fmt] of SLIDER_FIELDS) {
  $(elId).addEventListener("input", (e) => {
    $(`${elId}-out`).textContent = fmt(Number(e.target.value));
  });
}

$("settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {};
  for (const [elId, key] of SLIDER_FIELDS) {
    payload[key] = Number($(elId).value);
  }
  await api("/settings", { method: "POST", body: JSON.stringify(payload) });
  const saved = $("settings-saved");
  saved.classList.remove("hidden");
  setTimeout(() => saved.classList.add("hidden"), 2000);
});

const VAPID_PUBLIC_KEY = "BPoSIbWySAZ7c9ATVDYBeUEFqOxv7P4wieAYinYoRccus5n4IAa1HbaoNAXPcbUCBBJxSMZDxIEUQJHaf9VVC4o";

// ---- Push notifications ----

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function checkPushStatus() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  const reg = await navigator.serviceWorker.register("/sw.js");
  const existing = await reg.pushManager.getSubscription();
  $("push-banner").classList.toggle("hidden", !!existing);
}

$("enable-push").addEventListener("click", async () => {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    const reg = await navigator.serviceWorker.register("/sw.js");
    // const { publicKey } = await api("/push/vapid-public-key")
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      //applicationServerKey: urlBase64ToUint8Array(publicKey)
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });

    await api("/push/subscribe", { method: "POST", body: JSON.stringify(subscription.toJSON()) });
    $("push-banner").classList.add("hidden");
  } catch (err) {
    console.error("Push enable failed", err);
  }
});

// ---- Boot ----

checkSetup();
