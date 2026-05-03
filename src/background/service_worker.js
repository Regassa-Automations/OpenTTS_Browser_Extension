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
  return `${sessionId}:${paragraphId}:${voice}:${model}`;
}


async function sendToOffscreen(message) {
  return chrome.runtime.sendMessage(message).catch(() => undefined);
}

async function broadcastSessionUpdate(session, patch = {}) {
  const current = sessionsByTab.get(session.tabId);
  const base = current && current.sessionId === session.sessionId ? current : session;
  const next = { ...base, ...patch };
  sessionsByTab.set(next.tabId, next);
  await chrome.tabs.sendMessage(next.tabId, {
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
  const state = prefetchStateBySession.get(sessionId);
  if (state) {
    prefetchStateBySession.set(sessionId, { ...state, token: state.token + 1 });
    return;
  }
  prefetchStateBySession.delete(sessionId);
}

function ensurePrefetchState(session) {
  const existing = prefetchStateBySession.get(session.sessionId);
  return {
    startedAtMs: Date.now(),
    playingSinceMs: Date.now(),
    minListenMs: session.prefetchMinListenMs,
    minDelayMs: session.prefetchMinDelayMs,
    progressThreshold: session.prefetchProgressThreshold,
    didPrefetch: false,
    didPrefetchDepth2: false,
    token: (existing?.token ?? 0) + 1,
  };
}

function isSessionActive(session) {
  const current = sessionsByTab.get(session.tabId);
  return Boolean(current && current.sessionId === session.sessionId && activeSessionRef.sessionId === session.sessionId);
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
  if (!isSessionActive(session)) return false;
  const state = prefetchStateBySession.get(session.sessionId);
  if (!state || state.didPrefetch) return false;

  const progress = progressMeta.duration > 0 ? (progressMeta.currentTime / progressMeta.duration) : 0;
  const listenMs = Math.max(0, Date.now() - state.startedAtMs);
  const elapsedMs = Math.max(0, Date.now() - state.playingSinceMs);
  const isPlaying = session.status === SESSION_STATUS.PLAYING;
  if (progress >= state.progressThreshold || listenMs >= state.minListenMs || (isPlaying && elapsedMs >= state.minDelayMs)) {
    state.didPrefetch = true;
    prefetchStateBySession.set(session.sessionId, state);
    return true;
  }
  return false;
}

function shouldPrefetchDepthTwo(session, progressMeta = {}) {
  if (!isSessionActive(session)) return false;
  const state = prefetchStateBySession.get(session.sessionId);
  if (!state || state.didPrefetchDepth2) return false;

  const progress = progressMeta.duration > 0 ? (progressMeta.currentTime / progressMeta.duration) : 0;
  const listenMs = Math.max(0, Date.now() - state.startedAtMs);
  const elapsedMs = Math.max(0, Date.now() - state.playingSinceMs);
  const isPlaying = session.status === SESSION_STATUS.PLAYING;

  if (progress >= 0.8 || listenMs >= (state.minListenMs * 2) || (isPlaying && elapsedMs >= (state.minDelayMs * 2))) {
    state.didPrefetchDepth2 = true;
    prefetchStateBySession.set(session.sessionId, state);
    return true;
  }
  return false;
}

async function maybeEmitBudgetWarning(session, usage, settings) {
  const monthlyBudget = Number(settings.monthlyBudgetUsd) || 0;
  if (monthlyBudget <= 0) return;

  const currentSession = sessionsByTab.get(session.tabId);
  if (!currentSession || currentSession.sessionId !== session.sessionId) return;

  const ratio = usage.estimatedUsd / monthlyBudget;
  const crossed = (currentSession.warnedThresholds || []).filter((t) => Number.isFinite(t));
  const nextThreshold = settings.warnThresholds.find((threshold) => ratio >= threshold && !crossed.includes(threshold));
  if (nextThreshold == null) return;

  const updatedWarned = [...crossed, nextThreshold];
  sessionsByTab.set(session.tabId, { ...currentSession, warnedThresholds: updatedWarned });
  await chrome.tabs.sendMessage(session.tabId, {
    type: MESSAGE_TYPES.BG_HUD_ERROR,
    payload: {
      errorCode: ERROR_CODE.QUOTA_ERROR,
      warningType: 'BUDGET_THRESHOLD',
      threshold: nextThreshold,
    },
  }).catch(() => undefined);
}

async function maybeEnforceHardStop(session, settings, usage) {
  if (!settings.hardStopAtLimit || usage.estimatedUsd < settings.monthlyBudgetUsd) {
    return false;
  }

  const currentSession = sessionsByTab.get(session.tabId);
  if (!currentSession || currentSession.sessionId !== session.sessionId) {
    return true;
  }

  await sendToOffscreen({ type: MESSAGE_TYPES.OFFSCREEN_STOP, payload: { sessionId: currentSession.sessionId } });
  invalidateSessionPrefetch(currentSession.sessionId);
  await broadcastSessionUpdate(currentSession, {
    status: SESSION_STATUS.BLOCKED,
    reason: SESSION_REASON.BUDGET_BLOCKED,
    errorCode: null,
    errorMessage: 'Budget limit reached.',
  });

  if (activeSessionRef.sessionId === currentSession.sessionId) {
    activeSessionRef.sessionId = null;
    activeSessionRef.tabId = null;
  }
  sessionsByTab.delete(currentSession.tabId);
  return true;
}

async function requestTts({ session, index, prefetchToken = null }) {
  const paragraphId = session.paragraphIds[index];
  const text = session.textById[paragraphId];
  const key = buildCacheKey({ sessionId: session.sessionId, paragraphId, model: session.model, voice: session.voice });

  if (cacheByKey.has(key)) return cacheByKey.get(key);
  if (inFlightByKey.has(key)) return inFlightByKey.get(key);

  const inFlight = (async () => {
    const settings = await getSettings();
    const usageBefore = await getUsageBucket();
    if (await maybeEnforceHardStop(session, settings, usageBefore)) {
      throw new Error('Budget limit reached.');
    }

    const result = await OpenRouterTtsAdapter.fetchAudio({
      apiKey: session.apiKey,
      text,
      voice: session.voice,
      model: session.model,
      format: 'mp3',
    });

    if (prefetchToken != null) {
      const prefetchState = prefetchStateBySession.get(session.sessionId);
      if (!prefetchState || prefetchState.token !== prefetchToken || !isSessionActive(session)) {
        return result;
      }
    }

    cacheByKey.set(key, result);
    const usage = await incrementUsage({ charCount: result.charCount, estimatedUsd: result.estimatedUsd });
    await maybeEmitBudgetWarning(session, usage, settings);
    if (await maybeEnforceHardStop(session, settings, usage)) {
      throw new Error('Budget limit reached.');
    }
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
      payload: {
        sessionId: next.sessionId,
        audioDataUrl: tts.audioDataUrl,
        index,
        startSeconds: Number.isFinite(opts.startSeconds) ? Math.max(0, opts.startSeconds) : 0,
      },
    });

    next = await broadcastSessionUpdate(next, { status: SESSION_STATUS.PLAYING, duration: 0, currentTime: 0 });
    if (!opts.isPrefetch) {
      prefetchStateBySession.set(next.sessionId, ensurePrefetchState(next));
    }
  } catch (error) {
    const code = isKnownErrorCode(error?.code) ? error.code : ERROR_CODE.UPSTREAM_ERROR;
    const errorMessage = error instanceof Error ? error.message : String(error);
    await broadcastSessionUpdate(next, {
      status: SESSION_STATUS.ERROR,
      reason: SESSION_REASON.ERROR,
      errorCode: code,
      errorMessage,
    });
    await chrome.tabs.sendMessage(next.tabId, {
      type: MESSAGE_TYPES.BG_HUD_ERROR,
      payload: {
        errorCode: code,
        message: errorMessage,
      },
    }).catch(() => undefined);
  }
}

function handleAudioTime(session, { index, currentTime, duration }) {
  const parsedDuration = Number(duration);
  const normalizedDuration = Number.isFinite(parsedDuration) ? parsedDuration : 0;
  const durationByIndex = { ...(session.durationByIndex || {}) };
  if (Number.isInteger(index) && index >= 0) {
    durationByIndex[index] = normalizedDuration;
  }

  return broadcastSessionUpdate(session, {
    currentTime: currentTime ?? 0,
    duration: normalizedDuration,
    durationByIndex,
  });
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

  const priorSession = sessionsByTab.get(senderTabId);
  if (priorSession) {
    await sendToOffscreen({ type: MESSAGE_TYPES.OFFSCREEN_STOP, payload: { sessionId: priorSession.sessionId } });
    invalidateSessionPrefetch(priorSession.sessionId);
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
    prefetchMinDelayMs: settings.prefetchMinDelayMs,
    status: SESSION_STATUS.LOADING,
    reason: null,
    warnedThresholds: [],
  };

  sessionsByTab.set(senderTabId, session);
  activeSessionRef.sessionId = session.sessionId;
  activeSessionRef.tabId = senderTabId;

  await broadcastSessionUpdate(session, { status: SESSION_STATUS.LOADING });
  await playSessionIndex(session, session.activeIndex);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;
  
  sendResponse({ ok: true });

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
            invalidateSessionPrefetch(session.sessionId);
            await sendToOffscreen({ type: MESSAGE_TYPES.OFFSCREEN_PAUSE, payload: { sessionId: session.sessionId } });
            await broadcastSessionUpdate(session, { status: SESSION_STATUS.PAUSED });
            break;
          case HUD_ACTION.RESUME:
            await sendToOffscreen({ type: MESSAGE_TYPES.OFFSCREEN_RESUME, payload: { sessionId: session.sessionId } });
            await broadcastSessionUpdate(session, { status: SESSION_STATUS.PLAYING });
            break;
          case HUD_ACTION.NEXT:
            invalidateSessionPrefetch(session.sessionId);
            await playSessionIndex(session, session.activeIndex + 1);
            break;
          case HUD_ACTION.PREV:
            invalidateSessionPrefetch(session.sessionId);
            await playSessionIndex(session, session.activeIndex - 1);
            break;
          case HUD_ACTION.SEEK_REL: {
            const deltaSeconds = Number(message.payload?.deltaSeconds) || 0;
            await sendToOffscreen({ type: MESSAGE_TYPES.OFFSCREEN_SEEK_REL, payload: { sessionId: session.sessionId, deltaSeconds } });
            break;
          }
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
          const prefetchState = prefetchStateBySession.get(session.sessionId);
          if (evaluatePrefetchGate(session, message.payload)) {
            void requestTts({ session, index: session.activeIndex + 1, prefetchToken: prefetchState?.token ?? null }).catch(() => undefined);
          }
          if (shouldPrefetchDepthTwo(session, message.payload)) {
            void requestTts({ session, index: session.activeIndex + 2, prefetchToken: prefetchState?.token ?? null }).catch(() => undefined);
          }
        }
        break;
      case MESSAGE_TYPES.OFFSCREEN_AUDIO_ENDED:
      case MESSAGE_TYPES.OFFSCREEN_SEEK_OVERFLOW:
        if (session && message.payload?.sessionId === session.sessionId) {
          if (message.type === MESSAGE_TYPES.OFFSCREEN_SEEK_OVERFLOW) {
            invalidateSessionPrefetch(session.sessionId);
          }
          await playSessionIndex(session, session.activeIndex + 1);
        }
        break;
      case MESSAGE_TYPES.OFFSCREEN_SEEK_UNDERFLOW:
        if (session && message.payload?.sessionId === session.sessionId) {
          invalidateSessionPrefetch(session.sessionId);
          if (session.activeIndex > 0) {
            const previousDuration = Number(session.durationByIndex?.[session.activeIndex - 1]) || 0;
            await playSessionIndex(session, session.activeIndex - 1, {
              startSeconds: Math.max(previousDuration - 15, 0),
            });
          } else {
            await playSessionIndex(session, session.activeIndex, { startSeconds: 0 });
          }
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
