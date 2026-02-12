function msToNice(ms) {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h <= 0) return `${mm}m`;
  return `${h}h ${mm}m`;
}

function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function lastNDaysKeys(n) {
  const keys = [];
  const t = Date.now();
  for (let i = 0; i < n; i++) {
    keys.push(dayKey(t - i * 24 * 3600 * 1000));
  }
  return keys;
}

async function load() {
  const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });

  const dk = dayKey();
  const todayMs = (state.totalsByDay?.[dk] || 0);
  document.getElementById("todayTotal").textContent = `Today: ${msToNice(todayMs)}`;

  const weekKeys = lastNDaysKeys(7);
  const weekMs = weekKeys.reduce((sum, k) => sum + (state.totalsByDay?.[k] || 0), 0);
  document.getElementById("weekTotal").textContent = `Last 7 days: ${msToNice(weekMs)}`;

  // Top domains today
  const domMap = state.domainsByDay?.[dk] || {};
  const rows = Object.entries(domMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([domain, ms]) => `<tr><td>${domain}</td><td>${msToNice(ms)}</td></tr>`)
    .join("");

  document.getElementById("topDomains").innerHTML = rows || `<tr><td colspan="2">No data yet.</td></tr>`;

  // Presets
  const presetsDiv = document.getElementById("presets");
  const presets = state.presets || [];
  presetsDiv.innerHTML = presets.length ? "" : "<p>No presets yet. Create one in the popup.</p>";

  for (const p of presets) {
    const el = document.createElement("div");
    el.className = "row";
    el.style.marginBottom = "8px";
    el.innerHTML = `
      <div class="pill">${p.name}</div>
      <div class="pill">Env: ${p.env}</div>
      <div class="pill">Audio: ${p.audioOn ? "On" : "Off"}</div>
      <div class="pill">Duration: ${p.durationMin}m</div>
      <button data-del="${p.id}">Delete</button>
      <button data-start="${p.id}">Start</button>
    `;
    presetsDiv.appendChild(el);
  }

  presetsDiv.onclick = async (e) => {
    const delId = e.target?.getAttribute?.("data-del");
    const startId = e.target?.getAttribute?.("data-start");

    if (delId) {
      await chrome.runtime.sendMessage({ type: "DELETE_PRESET", id: delId });
      await load();
    }

    if (startId) {
      const preset = (state.presets || []).find(x => x.id === startId);
      if (!preset) return;
      await chrome.runtime.sendMessage({
        type: "START_SESSION",
        env: preset.env,
        audioOn: preset.audioOn
      });
      await load();
    }
  };
}

load();