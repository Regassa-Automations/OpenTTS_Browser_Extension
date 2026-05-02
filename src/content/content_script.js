import { createButtonInjector } from './button_injector.js';
import { createHudController } from './hud.js';
import { HUD_ACTION, MESSAGE_TYPES, SESSION_STATUS } from '../shared/message_types.js';
import { getSettings } from '../shared/storage.js';

let queueSnapshot = [];
const nodeById = new Map();
let autoScrollEnabled = false;

function buildQueueFrom(ttsId) {
  const startIndex = queueSnapshot.findIndex((record) => record.ttsId === ttsId);
  if (startIndex < 0) return null;

  const queue = queueSnapshot.slice(startIndex);
  const paragraphIds = queue.map((item) => item.ttsId);
  const textById = Object.fromEntries(queue.map((item) => [item.ttsId, item.text]));
  return { paragraphIds, textById, startIndex: 0 };
}

function sendMessage(type, payload) {
  try {
    return chrome.runtime.sendMessage({ type, payload }).catch(() => undefined);
  } catch (_error) {
    return Promise.resolve(undefined);
  }
}

async function bootstrap() {
  const rawSettingsResult = await chrome.storage.local.get('settings').catch(() => ({}));
  const rawSettings = (rawSettingsResult && typeof rawSettingsResult.settings === 'object')
    ? rawSettingsResult.settings
    : {};

  const settings = await getSettings().catch(() => ({}));
  autoScrollEnabled = Object.prototype.hasOwnProperty.call(rawSettings, 'autoScrollEnabled')
    ? Boolean(rawSettings.autoScrollEnabled)
    : (Object.prototype.hasOwnProperty.call(rawSettings, 'autoScroll')
      ? Boolean(rawSettings.autoScroll)
      : Boolean(settings?.autoScrollEnabled));

  const hud = createHudController({
    onAction: ({ action, deltaSeconds }) => {
      sendMessage(MESSAGE_TYPES.CONTENT_HUD_ACTION, {
        action,
        deltaSeconds: action === HUD_ACTION.SEEK_REL ? Number(deltaSeconds) || 0 : undefined,
      });

      if (action === HUD_ACTION.STOP) {
        hud.clearHighlight();
        hud.hide();
      }
    },
  });

  const injector = createButtonInjector({
    settings,
    onPlayClick: ({ ttsId }) => {
      queueSnapshot = injector.getReadableQueueSnapshot();
      nodeById.clear();
      queueSnapshot.forEach((record) => nodeById.set(record.ttsId, record.node));

      const payload = buildQueueFrom(ttsId);
      if (!payload) return;
      hud.onSessionUpdate({ status: SESSION_STATUS.LOADING, currentTime: 0, duration: 0 }, 'Starting playback…');
      sendMessage(MESSAGE_TYPES.CONTENT_START_SESSION, payload);
    },
  });

  injector.start();
  queueSnapshot = injector.getReadableQueueSnapshot();
  queueSnapshot.forEach((record) => nodeById.set(record.ttsId, record.node));

  chrome.runtime.onMessage.addListener((message) => {
    if (!message?.type) return;

    if (message.type === MESSAGE_TYPES.BG_SESSION_UPDATE) {
      const payload = message.payload || {};
      const activeId = payload.paragraphId;
      const node = activeId ? nodeById.get(activeId) : null;
      const snippet = activeId && payload.status !== SESSION_STATUS.STOPPED
        ? (queueSnapshot.find((item) => item.ttsId === activeId)?.text || '').slice(0, 180)
        : '';

      hud.onSessionUpdate(payload, snippet);
      if (payload.status === SESSION_STATUS.STOPPED) {
        hud.clearHighlight();
      } else {
        hud.setActiveNode(node, autoScrollEnabled);
      }
      return;
    }

    if (message.type === MESSAGE_TYPES.BG_HUD_ERROR) {
      hud.onHudError(message.payload?.message);
    }
  });
}

void bootstrap();
