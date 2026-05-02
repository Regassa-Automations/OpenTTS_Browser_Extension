import { ERROR_CODE, MESSAGE_TYPES } from '../shared/message_types.js';

const audio = new Audio();
audio.preload = 'auto';

let activeSessionId = null;
let activeIndex = null;
let lastSrc = '';

function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, payload }).catch(() => undefined);
}

function emitState(state, extra = {}) {
  if (!activeSessionId) return;
  void send(MESSAGE_TYPES.OFFSCREEN_AUDIO_STATE, {
    sessionId: activeSessionId,
    state,
    index: activeIndex,
    ...extra,
  });
}

function resetAudio() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  lastSrc = '';
}

async function playFromDataUrl({ sessionId, audioDataUrl, index }) {
  if (!sessionId || typeof audioDataUrl !== 'string' || audioDataUrl.length === 0) {
    throw new Error('OFFSCREEN_PLAY requires sessionId and audioDataUrl.');
  }

  activeSessionId = sessionId;
  activeIndex = Number.isInteger(index) ? index : null;

  try {
    if (lastSrc !== audioDataUrl) {
      audio.src = audioDataUrl;
      lastSrc = audioDataUrl;
    }
    audio.currentTime = 0;
    await audio.play();
    emitState('playing');
  } catch (error) {
    emitState('error');
    await send(MESSAGE_TYPES.OFFSCREEN_AUDIO_ERROR, {
      sessionId,
      index: activeIndex,
      errorCode: ERROR_CODE.UPSTREAM_ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function ensureSession(messageSessionId) {
  return Boolean(activeSessionId && messageSessionId && messageSessionId === activeSessionId);
}

audio.addEventListener('timeupdate', () => {
  if (!activeSessionId) return;
  void send(MESSAGE_TYPES.OFFSCREEN_AUDIO_TIME, {
    sessionId: activeSessionId,
    index: activeIndex,
    currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
    duration: Number.isFinite(audio.duration) ? audio.duration : 0,
  });
});

audio.addEventListener('ended', () => {
  if (!activeSessionId) return;
  emitState('ended');
  void send(MESSAGE_TYPES.OFFSCREEN_AUDIO_ENDED, {
    sessionId: activeSessionId,
    index: activeIndex,
  });
});

audio.addEventListener('error', () => {
  if (!activeSessionId) return;
  const mediaError = audio.error;
  emitState('error');
  void send(MESSAGE_TYPES.OFFSCREEN_AUDIO_ERROR, {
    sessionId: activeSessionId,
    index: activeIndex,
    errorCode: ERROR_CODE.PARSE_ERROR,
    message: mediaError ? `Audio error code ${mediaError.code}` : 'Unknown audio playback error.',
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) return false;

  (async () => {
    const payload = message.payload ?? {};
    switch (message.type) {
      case MESSAGE_TYPES.OFFSCREEN_PLAY:
        await playFromDataUrl(payload);
        break;
      case MESSAGE_TYPES.OFFSCREEN_PAUSE:
        if (ensureSession(payload.sessionId)) {
          audio.pause();
          emitState('paused');
        }
        break;
      case MESSAGE_TYPES.OFFSCREEN_RESUME:
        if (ensureSession(payload.sessionId)) {
          await audio.play();
          emitState('playing');
        }
        break;
      case MESSAGE_TYPES.OFFSCREEN_SEEK_REL:
        if (ensureSession(payload.sessionId)) {
          const delta = Number(payload.deltaSeconds) || 0;
          const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
          const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
          const nextTime = current + delta;
          if (nextTime < 0) {
            await send(MESSAGE_TYPES.OFFSCREEN_SEEK_UNDERFLOW, {
              sessionId: activeSessionId,
              index: activeIndex,
              attemptedTime: nextTime,
            });
          } else if (duration > 0 && nextTime > duration) {
            await send(MESSAGE_TYPES.OFFSCREEN_SEEK_OVERFLOW, {
              sessionId: activeSessionId,
              index: activeIndex,
              attemptedTime: nextTime,
              duration,
            });
          } else {
            audio.currentTime = nextTime;
            emitState('seeking', { currentTime: audio.currentTime, duration });
          }
        }
        break;
      case MESSAGE_TYPES.OFFSCREEN_STOP:
        if (ensureSession(payload.sessionId)) {
          resetAudio();
          emitState('stopped');
          activeSessionId = null;
          activeIndex = null;
        }
        break;
      default:
        break;
    }

    sendResponse({ ok: true });
  })().catch((error) => {
    void send(MESSAGE_TYPES.OFFSCREEN_AUDIO_ERROR, {
      sessionId: activeSessionId,
      index: activeIndex,
      errorCode: ERROR_CODE.UPSTREAM_ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    sendResponse({ ok: false, message: error instanceof Error ? error.message : String(error) });
  });

  return true;
});
