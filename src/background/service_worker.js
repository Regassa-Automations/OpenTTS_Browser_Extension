import { OpenRouterTtsAdapter } from './openrouter_client.js';
import { ERROR_CODE, HUD_ACTION, MESSAGE_TYPES, SESSION_REASON, SESSION_STATUS } from '../shared/message_types.js';
import { getSettings, getUsageBucket, incrementUsage } from '../shared/storage.js';

const activeSessionRef = { sessionId: null, tabId: null };
const sessionsByTab = new Map();
const prefetchStateBySession = new Map();
const cacheByKey = new Map();
const inFlightByKey = new Map();

function createSessionId(tabId) {
  return `sess_${tabId}_${Date.now()}`;
}

function buildCacheKey({ sessionId, paragraphId, model, voice }) {
  return `${sessionId}::${paragraphId}::${model}::${voice}`;
}


async function sendToOffscreen(message) {
  return chrome.runtime.sendMessage(message).catch(() => undefined);
}

async function broadcastSessionUpdate(session, patch = {}) {
  const next = { ...session, ...patch };
  sessionsByTab.set(session.tabId, next);
  await chrome.tabs.sendMessage(session.tabId, {
    type: MESSAGE_TYPES.BG_SESSION_UPDATE,
    payload: {
      sessionId: next.sessionId,
      status: next.status,
      reason: next.reason ?? null,
      activeIndex: next.activeIndex,
      queueLength: next.paragraphIds.length,
      paragraphId: next.paragraphIds[next.activeIndex] ?? null,
      currentTime: next.currentTime ?? 0,
      duration: next.duration ?? 0,
      errorCode: next.errorCode ?? null,
      errorMessage: next.errorMessage ?? null,
    },
  }).catch(() => undefined);
  return next;
}

function invalidateSessionPrefetch(sessionId) {
  prefetchStateBySession.delete(sessionId);
}

async function stopSession(tabId, reason) {
  const session = sessionsByTab.get(tabId);
  if (!session) return;

  await sendToOffscreen({ type: MESSAGE_TYPES.OFFSCREEN_STOP, payload: { sessionId: session.sessionId } });
  invalidateSessionPrefetch(session.sessionId);

  if (activeSessionRef.sessionId === session.sessionId) {
    activeSessionRef.sessionId = null;
    activeSessionRef.tabId = null;
  }

  await broadcastSessionUpdate(session, { status: SESSION_STATUS.STOPPED, reason });
  sessionsByTab.delete(tabId);
}


function evaluatePrefetchGate(session, progressMeta = {}) {
  const state = prefetchStateBySession.get(session.sessionId);
  if (!state || state.didPrefetch) return false;

  const progress = progressMeta.duration > 0 ? (progressMeta.currentTime / progressMeta.duration) : 0;
  const listenMs = Math.max(0, Date.now() - state.startedAtMs);
  if (progress >= state.progressThreshold && listenMs >= state.minListenMs) {
    state.didPrefetch = true;
    prefetchStateBySession.set(session.sessionId, state);
    return true;
  }
  return false;
}

async function requestTts({ session, index }) {
  const paragraphId = session.paragraphIds[index];
  const text = session.textById[paragraphId];
  const key = buildCacheKey({ sessionId: session.sessionId, paragraphId, model: session.model, voice: session.voice });

  if (cacheByKey.has(key)) return cacheByKey.get(key);
  if (inFlightByKey.has(key)) return inFlightByKey.get(key);

  const inFlight = (async () => {
    const result = await OpenRouterTtsAdapter.fetchAudio({
      apiKey: session.apiKey,
      text,
      voice: session.voice,
      model: session.model,
      format: 'mp3',
    });
    cacheByKey.set(key, result);
    await incrementUsage({ charCount: result.charCount, estimatedUsd: result.estimatedUsd });
    return result;
  })();

  inFlightByKey.set(key, inFlight);
  try {
    return await inFlight;
  } finally {
    inFlightByKey.delete(key);
  }
}

async function playSessionIndex(session, index, opts = {}) {
  if (!session || index < 0 || index >= session.paragraphIds.length) {
    await stopSession(session?.tabId, SESSION_REASON.QUEUE_ENDED);
    return;
  }

  let next = await broadcastSessionUpdate(session, {
    activeIndex: index,
    status: SESSION_STATUS.LOADING,
    reason: null,
    errorCode: null,
    errorMessage: null,
  });

  try {
    const tts = await requestTts({ session: next, index });
    await sendToOffscreen({
      type: MESSAGE_TYPES.OFFSCREEN_PLAY,
      payload: { sessionId: next.sessionId, audioDataUrl: tts.audioDataUrl, index },
    });

    next = await broadcastSessionUpdate(next, { status: SESSION_STATUS.PLAYING, duration: 0, currentTime: 0 });
    if (!opts.isPrefetch) {
      prefetchStateBySession.set(next.sessionId, {
        startedAtMs: Date.now(),
        minListenMs: next.prefetchMinListenMs,
        progressThreshold: next.prefetchProgressThreshold,
        didPrefetch: false,
      });
    }
  } catch (error) {
    const code = error?.code && ERROR_CODE[error.code] ? error.code : ERROR_CODE.UPSTREAM_ERROR;
    await broadcastSessionUpdate(next, {
      status: SESSION_STATUS.ERROR,
      reason: SESSION_REASON.ERROR,
      errorCode: code,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

function handleAudioTime(session, { currentTime, duration }) {
  return broadcastSessionUpdate(session, { currentTime: currentTime ?? 0, duration: duration ?? 0 });
}


function sendSafeResponse(sendResponse, payload) {
  try {
    sendResponse(payload);
  } catch (_error) {
    // Ignore response channel closure in fire-and-forget callers.
  }
}

function isKnownErrorCode(code) {
  return typeof code === 'string' && Object.values(ERROR_CODE).includes(code);
}

function getSessionForMessage(message, sender) {
  const tabId = sender?.tab?.id;
  if (Number.isInteger(tabId)) {
    return sessionsByTab.get(tabId) ?? null;
  }

  const sessionId = message?.payload?.sessionId;
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return null;
  }

  for (const candidate of sessionsByTab.values()) {
    if (candidate.sessionId === sessionId) {
      return candidate;
    }
  }
  return null;
}

async function startSessionFromContent(payload, senderTabId) {
  if (!payload || !Array.isArray(payload.paragraphIds) || payload.paragraphIds.length === 0 || !payload.textById) return;

  const settings = await getSettings();
  if (settings.singleSessionGlobal && activeSessionRef.tabId != null && activeSessionRef.tabId !== senderTabId) {
    await stopSession(activeSessionRef.tabId, SESSION_REASON.SUPERSEDED_BY_NEW_TAB);
  }

  const usage = await getUsageBucket();
  if (settings.hardStopAtLimit && usage.estimatedUsd >= settings.monthlyBudgetUsd) {
    const blockedSession = {
      sessionId: createSessionId(senderTabId),
      tabId: senderTabId,
      paragraphIds: payload.paragraphIds,
      textById: payload.textById,
      activeIndex: payload.startIndex ?? 0,
      status: SESSION_STATUS.BLOCKED,
      reason: SESSION_REASON.BUDGET_BLOCKED,
      errorCode: null,
      errorMessage: 'Budget limit reached.',
    };
    sessionsByTab.set(senderTabId, blockedSession);
    await broadcastSessionUpdate(blockedSession);
    return;
  }

  const session = {
    sessionId: createSessionId(senderTabId),
    tabId: senderTabId,
    paragraphIds: payload.paragraphIds,
    textById: payload.textById,
    activeIndex: payload.startIndex ?? 0,
    apiKey: settings.apiKey,
    model: settings.model,
    voice: settings.voice,
    prefetchMinListenMs: settings.prefetchMinListenMs,
    prefetchProgressThreshold: settings.prefetchProgressThreshold,
    status: SESSION_STATUS.LOADING,
    reason: null,
  };

  sessionsByTab.set(senderTabId, session);
  activeSessionRef.sessionId = session.sessionId;
  activeSessionRef.tabId = senderTabId;

  await broadcastSessionUpdate(session, { status: SESSION_STATUS.LOADING });
  await playSessionIndex(session, session.activeIndex);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  (async () => {
    const tabId = sender?.tab?.id;
    const session = getSessionForMessage(message, sender);

    switch (message.type) {
      case MESSAGE_TYPES.CONTENT_START_SESSION:
        if (!Number.isInteger(tabId)) {
          throw new Error('CONTENT_START_SESSION requires a tab sender.');
        }
        await startSessionFromContent(message.payload, tabId);
        break;
      case MESSAGE_TYPES.CONTENT_HUD_ACTION:
        if (!session) break;
        switch (message.payload?.action) {
          case HUD_ACTION.PAUSE:
            await sendToOffscreen({ type: MESSAGE_TYPES.OFFSCREEN_PAUSE, payload: { sessionId: session.sessionId } });
            await broadcastSessionUpdate(session, { status: SESSION_STATUS.PAUSED });
            break;
          case HUD_ACTION.RESUME:
            await sendToOffscreen({ type: MESSAGE_TYPES.OFFSCREEN_RESUME, payload: { sessionId: session.sessionId } });
            await broadcastSessionUpdate(session, { status: SESSION_STATUS.PLAYING });
            break;
          case HUD_ACTION.NEXT:
            await playSessionIndex(session, session.activeIndex + 1);
            break;
          case HUD_ACTION.PREV:
            await playSessionIndex(session, session.activeIndex - 1);
            break;
          case HUD_ACTION.SEEK_REL:
            await sendToOffscreen({ type: MESSAGE_TYPES.OFFSCREEN_SEEK_REL, payload: { sessionId: session.sessionId, deltaSeconds: Number(message.payload?.deltaSeconds) || 0 } });
            break;
          case HUD_ACTION.STOP:
            await stopSession(tabId, SESSION_REASON.USER_STOPPED);
            break;
          default:
            break;
        }
        break;
      case MESSAGE_TYPES.OFFSCREEN_AUDIO_TIME:
        if (session && message.payload?.sessionId === session.sessionId) {
          await handleAudioTime(session, message.payload);
          if (evaluatePrefetchGate(session, message.payload)) {
            void requestTts({ session, index: session.activeIndex + 1 }).catch(() => undefined);
          }
        }
        break;
      case MESSAGE_TYPES.OFFSCREEN_AUDIO_ENDED:
      case MESSAGE_TYPES.OFFSCREEN_SEEK_OVERFLOW:
        if (session && message.payload?.sessionId === session.sessionId) {
          await playSessionIndex(session, session.activeIndex + 1);
        }
        break;
      case MESSAGE_TYPES.OFFSCREEN_SEEK_UNDERFLOW:
        if (session && message.payload?.sessionId === session.sessionId) {
          await playSessionIndex(session, session.activeIndex - 1);
        }
        break;
      case MESSAGE_TYPES.OFFSCREEN_AUDIO_ERROR:
        if (session && message.payload?.sessionId === session.sessionId) {
          const maybeCode = message.payload?.errorCode;
          const errorCode = isKnownErrorCode(maybeCode) ? maybeCode : ERROR_CODE.UPSTREAM_ERROR;
          await broadcastSessionUpdate(session, {
            status: SESSION_STATUS.ERROR,
            reason: SESSION_REASON.ERROR,
            errorCode,
            errorMessage: message.payload?.message || 'Offscreen playback error.',
          });
        }
        break;
      default:
        break;
    }

    sendSafeResponse(sendResponse, { ok: true });
  })().catch((error) => {
    sendSafeResponse(sendResponse, { ok: false, message: error instanceof Error ? error.message : String(error) });
  });

  return true;
});
