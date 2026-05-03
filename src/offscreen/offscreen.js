import { ERROR_CODE, MESSAGE_TYPES } from '../shared/message_types.js';

const audio = new Audio();
audio.preload = 'auto';

let activeSessionId = null;
let activeIndex = null;
let lastSrc = '';
let playRequestId = 0;

const AUDIO_TIME_EMIT_INTERVAL_MS = 250;
const AUDIO_TIME_PROGRESS_DELTA_SECONDS = 0.05;

let lastTimeEmitAtMs = 0;
let lastEmittedCurrentTime = null;
let lastEmittedDuration = null;

function getAudioProgress() {
  return {
    currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
    duration: Number.isFinite(audio.duration) ? audio.duration : 0,
  };
}

function resetTimeEmitState() {
  lastTimeEmitAtMs = 0;
  lastEmittedCurrentTime = null;
  lastEmittedDuration = null;
}

function emitAudioTime({ force = false } = {}) {
  if (!activeSessionId) return;

  const now = Date.now();
  const { currentTime, duration } = getAudioProgress();
  const intervalElapsed = now - lastTimeEmitAtMs >= AUDIO_TIME_EMIT_INTERVAL_MS;
  const currentDelta =
    lastEmittedCurrentTime === null ? Number.POSITIVE_INFINITY : Math.abs(currentTime - lastEmittedCurrentTime);
  const durationChanged = lastEmittedDuration === null ? true : duration !== lastEmittedDuration;
  const progressChanged = currentDelta >= AUDIO_TIME_PROGRESS_DELTA_SECONDS;

  if (!force && !intervalElapsed && !progressChanged && !durationChanged) {
    return;
  }

  lastTimeEmitAtMs = now;
  lastEmittedCurrentTime = currentTime;
  lastEmittedDuration = duration;

  void send(MESSAGE_TYPES.OFFSCREEN_AUDIO_TIME, {
    sessionId: activeSessionId,
    index: activeIndex,
    currentTime,
    duration,
  });
}

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
  resetTimeEmitState();
}

function toPlaybackErrorCode(error) {
  const code = error?.code;
  switch (code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return ERROR_CODE.NETWORK_ERROR;
    case MediaError.MEDIA_ERR_NETWORK:
      return ERROR_CODE.NETWORK_ERROR;
    case MediaError.MEDIA_ERR_DECODE:
      return ERROR_CODE.PARSE_ERROR;
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return ERROR_CODE.BAD_REQUEST;
    default:
      return ERROR_CODE.UPSTREAM_ERROR;
  }
}

async function playFromDataUrl({ sessionId, audioDataUrl, index, startSeconds = 0 }) {
  if (!sessionId || typeof audioDataUrl !== 'string' || audioDataUrl.length === 0) {
    throw new Error('OFFSCREEN_PLAY requires sessionId and audioDataUrl.');
  }

  if (activeSessionId && activeSessionId !== sessionId) {
    resetAudio();
  }

  activeSessionId = sessionId;
  activeIndex = Number.isInteger(index) ? index : null;
  const requestId = ++playRequestId;

  try {
    if (lastSrc !== audioDataUrl) {
      audio.src = audioDataUrl;
      lastSrc = audioDataUrl;
      audio.load(); // Force load for new source
    }
    
    const parsedStart = Number(startSeconds);
    audio.currentTime = Number.isFinite(parsedStart) && parsedStart > 0 ? parsedStart : 0;
    
    emitState('loading');
    emitAudioTime({ force: true });
    
    await audio.play();
    
    if (requestId === playRequestId) {
      emitState('playing');
      emitAudioTime({ force: true });
    }
  } catch (error) {
    if (requestId !== playRequestId) return;
    
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
  emitAudioTime();
});

audio.addEventListener('ended', () => {
  if (!activeSessionId) return;
  emitAudioTime({ force: true });
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
    errorCode: toPlaybackErrorCode(mediaError),
    message: mediaError ? `Audio error code ${mediaError.code}` : 'Unknown audio playback error.',
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) return false;
  
  // FIX: Immediately acknowledge to avoid "Channel Closed" error in background script.
  sendResponse({ ok: true });

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
          emitAudioTime({ force: true });
        }
        break;
      case MESSAGE_TYPES.OFFSCREEN_RESUME:
        if (ensureSession(payload.sessionId)) {
          await audio.play();
          emitState('playing');
          emitAudioTime({ force: true });
        }
        break;
      case MESSAGE_TYPES.OFFSCREEN_SEEK_REL:
        if (ensureSession(payload.sessionId)) {
          const parsedDelta = Number(payload.deltaSeconds);
          const delta = Number.isFinite(parsedDelta) ? parsedDelta : 0;
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
            emitAudioTime({ force: true });
          }
        }
        break;
      case MESSAGE_TYPES.OFFSCREEN_STOP:
        if (ensureSession(payload.sessionId)) {
          emitState('stopped');
          resetAudio();
          activeSessionId = null;
          activeIndex = null;
        }
        break;
      default:
        break;
    }
  })().catch((error) => {
    console.error('Offscreen async error:', error);
  });

  return false;
});
