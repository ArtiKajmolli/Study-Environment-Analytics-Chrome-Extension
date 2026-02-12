let audio = null;

function stop() {
  if (audio) {
    audio.pause();
    audio = null;
  }
}

function play(env) {
  stop();
  const url = chrome.runtime.getURL(`assets/audio/${env}.mp3`);
  audio = new Audio(url);
  audio.loop = true;
  audio.volume = 0.6;
  audio.play().catch(() => {});
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "AUDIO_PLAY") play(msg.env);
  if (msg.type === "AUDIO_STOP") stop();
});