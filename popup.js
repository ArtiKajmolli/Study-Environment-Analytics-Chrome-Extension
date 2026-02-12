const env = document.getElementById("env");
const audioOn = document.getElementById("audioOn");
const statusEl = document.getElementById("status");

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  env.value = state.sessionEnv || "library";
  audioOn.checked = state.sessionAudioOn !== false;

  statusEl.textContent = state.sessionActive
    ? "Session running… tracking tabs + audio"
    : "Session stopped.";
}

document.getElementById("start").onclick = async () => {
  await chrome.runtime.sendMessage({
    type: "START_SESSION",
    env: env.value,
    audioOn: audioOn.checked
  });
  await refresh();
};

document.getElementById("stop").onclick = async () => {
  await chrome.runtime.sendMessage({ type: "STOP_SESSION" });
  await refresh();
};

env.onchange = async () => {
  await chrome.runtime.sendMessage({ type: "SET_ENV", env: env.value });
  await refresh();
};

audioOn.onchange = async () => {
  await chrome.runtime.sendMessage({ type: "TOGGLE_AUDIO", audioOn: audioOn.checked });
  await refresh();
};

document.getElementById("savePreset").onclick = async () => {
  const name = document.getElementById("presetName").value.trim() || "My Preset";
  const durationMin = Number(document.getElementById("durationMin").value) || 25;

  await chrome.runtime.sendMessage({
    type: "SAVE_PRESET",
    name,
    env: env.value,
    audioOn: audioOn.checked,
    durationMin
  });

  statusEl.textContent = "Preset saved.";
};

document.getElementById("openDashboard").onclick = async () => {
  await chrome.runtime.openOptionsPage();
};

refresh();