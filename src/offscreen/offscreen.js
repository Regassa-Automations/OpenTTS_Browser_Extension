// Offscreen audio playback and seek handling.

let audio = null;

function getAudio() {
  if (!audio) {
    audio = new Audio();
  }
  return audio;
}

function postSeekEvent(type, payload = {}) {
  chrome.runtime.sendMessage({
    type,
    source: 'offscreen',
    ...payload,
  });
}

function handleSeek(deltaSeconds) {
  const player = getAudio();

  if (!Number.isFinite(player.duration)) {
    return;
  }

  const nextTime = player.currentTime + deltaSeconds;

  if (nextTime < 0) {
    postSeekEvent('SEEK_UNDERFLOW', {
      attemptedTime: nextTime,
      currentTime: player.currentTime,
      duration: player.duration,
      deltaSeconds,
    });
    return;
  }

  if (nextTime > player.duration) {
    postSeekEvent('SEEK_OVERFLOW', {
      attemptedTime: nextTime,
      currentTime: player.currentTime,
      duration: player.duration,
      deltaSeconds,
    });
    return;
  }

  player.currentTime = nextTime;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'OFFSCREEN_SET_SRC') {
    const player = getAudio();
    player.src = message.src;
    player.currentTime = message.startAt ?? 0;
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === 'OFFSCREEN_SEEK') {
    handleSeek(Number(message.deltaSeconds) || 0);
    sendResponse({ ok: true });
    return;
  }
});
