const STATE_KEY = "state_v1"; // single place for app state

// ---------- Helpers ----------
function now() { return Date.now(); }

function domainFromUrl(url) {
  try { return new URL(url).hostname; } catch { return "unknown"; }
}

async function getState() {
  const data = await chrome.storage.local.get(STATE_KEY);
  return data[STATE_KEY] || {
    sessionActive: false,
    sessionStart: null,
    sessionEnv: "library",
    sessionAudioOn: true,
    lastActiveDomain: null,
    lastSwitchTs: null,
    idleState: "active",
    // stats
    totalsByDay: {},         // { "YYYY-MM-DD": ms }
    domainsByDay: {},        // { "YYYY-MM-DD": { "youtube.com": ms, ... } }
    sessions: [],            // session history
    presets: []              // saved presets
  };
}

async function setState(patch) {
  const s = await getState();
  const next = { ...s, ...patch };
  await chrome.storage.local.set({ [STATE_KEY]: next });
  return next;
}

function dayKey(ts = now()) {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function ensureOffscreen() {
  const exists = await chrome.offscreen.hasDocument?.();
  if (exists) return;

  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Play looping ambient environment audio during focus sessions."
  });
}

async function audioPlay(env) {
  await ensureOffscreen();
  chrome.runtime.sendMessage({ type: "AUDIO_PLAY", env });
}

async function audioStop() {
  const exists = await chrome.offscreen.hasDocument?.();
  if (!exists) return;
  chrome.runtime.sendMessage({ type: "AUDIO_STOP" });
}

// ---------- Tracking core ----------
async function addTimeForCurrentDomain(endTs) {
  const s = await getState();
  if (!s.sessionActive) return;
  if (s.idleState !== "active") return;

  const startTs = s.lastSwitchTs;
  const domain = s.lastActiveDomain;
  if (!startTs || !domain) return;

  const ms = Math.max(0, endTs - startTs);
  if (ms <= 0) return;

  const dk = dayKey(endTs);

  const totalsByDay = { ...s.totalsByDay };
  totalsByDay[dk] = (totalsByDay[dk] || 0) + ms;

  const domainsByDay = { ...s.domainsByDay };
  const dayMap = { ...(domainsByDay[dk] || {}) };
  dayMap[domain] = (dayMap[domain] || 0) + ms;
  domainsByDay[dk] = dayMap;

  await setState({ totalsByDay, domainsByDay, lastSwitchTs: endTs });
}

async function setActiveDomainFromTab(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const url = tab?.url || "";
  const domain = domainFromUrl(url);

  await setState({
    lastActiveDomain: domain,
    lastSwitchTs: now()
  });
}

// ---------- Session control ----------
async function startSession({ env, audioOn }) {
  const s = await getState();
  if (s.sessionActive) return;

  const t = now();
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const domain = domainFromUrl(tab?.url || "");

  await setState({
    sessionActive: true,
    sessionStart: t,
    sessionEnv: env || "library",
    sessionAudioOn: audioOn !== false,
    lastActiveDomain: domain,
    lastSwitchTs: t,
    idleState: "active"
  });

  if (audioOn !== false) await audioPlay(env || "library");
}

async function stopSession({ focusRating = null, notes = "" } = {}) {
  const s = await getState();
  if (!s.sessionActive) return;

  const t = now();
  await addTimeForCurrentDomain(t);

  const durationMs = Math.max(0, t - (s.sessionStart || t));
  const session = {
    start: s.sessionStart,
    end: t,
    durationMs,
    env: s.sessionEnv,
    focusRating,
    notes
  };

  const sessions = [session, ...(s.sessions || [])].slice(0, 200); // cap history

  await setState({
    sessionActive: false,
    sessionStart: null,
    lastActiveDomain: null,
    lastSwitchTs: null,
    sessions
  });

  await audioStop();
}

// ---------- Chrome events ----------
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const t = now();
  await addTimeForCurrentDomain(t);
  const s = await getState();
  if (s.sessionActive && s.idleState === "active") {
    await setActiveDomainFromTab(tabId);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!info.url) return;
  const s = await getState();
  if (!s.sessionActive) return;
  if (tabId !== tab?.id) return;

  const t = now();
  await addTimeForCurrentDomain(t);
  await setState({ lastActiveDomain: domainFromUrl(info.url), lastSwitchTs: t });
});

// Idle detection: don’t count time while idle/locked
chrome.idle.setDetectionInterval(60);
chrome.idle.onStateChanged.addListener(async (state) => {
  const t = now();
  await addTimeForCurrentDomain(t);
  await setState({ idleState: state });

  const s = await getState();
  if (!s.sessionActive) return;

  if (state === "active") {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await setState({
      lastActiveDomain: domainFromUrl(tab?.url || ""),
      lastSwitchTs: now()
    });
  }
});

// ---------- Messages from popup/options ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === "GET_STATE") {
      sendResponse(await getState());
      return;
    }

    if (msg.type === "START_SESSION") {
      await startSession({ env: msg.env, audioOn: msg.audioOn });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "STOP_SESSION") {
      await stopSession({ focusRating: msg.focusRating ?? null, notes: msg.notes ?? "" });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "SET_ENV") {
      const s = await setState({ sessionEnv: msg.env });
      // If session is active and audio on, switch audio immediately
      if (s.sessionActive && s.sessionAudioOn) await audioPlay(msg.env);
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "TOGGLE_AUDIO") {
      const s = await setState({ sessionAudioOn: !!msg.audioOn });
      if (!s.sessionActive) { sendResponse({ ok: true }); return; }

      if (s.sessionAudioOn) await audioPlay(s.sessionEnv);
      else await audioStop();

      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "SAVE_PRESET") {
      const s = await getState();
      const preset = {
        id: crypto.randomUUID(),
        name: msg.name,
        env: msg.env,
        audioOn: msg.audioOn !== false,
        durationMin: msg.durationMin || 25
      };
      const presets = [preset, ...(s.presets || [])].slice(0, 50);
      await setState({ presets });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "DELETE_PRESET") {
      const s = await getState();
      const presets = (s.presets || []).filter(p => p.id !== msg.id);
      await setState({ presets });
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message type" });
  })();

  return true; // keep message channel open for async
});