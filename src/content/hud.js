import { HUD_ACTION, SESSION_STATUS } from '../shared/message_types.js';
import { createAutoScroller } from './auto_scroll.js';

const HIGHLIGHT_ATTR = 'data-tts-active';

function createIcon(pathD) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathD);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

export function createHudController({ onAction = () => {} } = {}) {
  let root;
  let statusEl;
  let progressEl;
  let snippetEl;
  let playPauseButton;
  let playPauseAction = HUD_ACTION.PAUSE;
  let visible = false;
  let activeNode = null;
  const autoScroller = createAutoScroller();

  function ensureMounted() {
    if (root) return;

    root = document.createElement('section');
    root.setAttribute('data-tts-hud', 'true');
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Text to speech controls');
    root.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:16px', 'transform:translateX(-50%)',
      'z-index:2147483647', 'display:none', 'min-width:360px', 'max-width:min(92vw, 720px)',
      'background:#111827', 'color:#f9fafb', 'border-radius:12px', 'padding:10px 12px',
      'box-shadow:0 12px 30px rgba(0,0,0,0.25)', 'font:13px/1.4 system-ui,sans-serif'
    ].join(';');

    const statusRow = document.createElement('div');
    statusEl = document.createElement('strong');
    statusEl.textContent = 'Idle';
    statusRow.append(statusEl);

    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;gap:8px;align-items:center;margin:8px 0;';

    function mkBtn(pathD, title, cb) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = title;
      btn.setAttribute('aria-label', title);
      btn.style.cssText = 'border:1px solid rgba(255,255,255,0.25);background:#1f2937;color:#fff;border-radius:8px;padding:6px 8px;cursor:pointer;';
      btn.append(createIcon(pathD));
      btn.addEventListener('click', cb);
      return btn;
    }

    controls.append(
      mkBtn('M11 18V6L2.5 12 11 18zm1-6 8.5 6V6L12 12z', 'Previous paragraph', () => onAction({ action: HUD_ACTION.PREV })),
      mkBtn('M12 6V3L8 7l4 4V8c2.8 0 5 2.2 5 5 0 .9-.2 1.8-.7 2.5l1.5 1.1c.8-1.1 1.2-2.3 1.2-3.6 0-3.9-3.1-7-7-7zM5.2 13c0-.9.2-1.8.7-2.5l-1.5-1.1C3.6 10.5 3.2 11.7 3.2 13c0 3.9 3.1 7 7 7v3l4-4-4-4v3c-2.8 0-5-2.2-5-5z', 'Rewind 15 seconds', () => onAction({ action: HUD_ACTION.SEEK_REL, deltaSeconds: -15 })),
    );
    playPauseButton = mkBtn('M6 4h4v16H6V4zm8 0h4v16h-4V4z', 'Pause or resume', () => onAction({ action: playPauseAction }));
    controls.append(playPauseButton);
    controls.append(
      mkBtn('M12 6V3l4 4-4 4V8c-2.8 0-5 2.2-5 5 0 .9.2 1.8.7 2.5l-1.5 1.1c-.8-1.1-1.2-2.3-1.2-3.6 0-3.9 3.1-7 7-7zM18.8 13c0-.9-.2-1.8-.7-2.5l1.5-1.1c.8 1.1 1.2 2.3 1.2 3.6 0 3.9-3.1 7-7 7v3l-4-4 4-4v3c2.8 0 5-2.2 5-5z', 'Forward 15 seconds', () => onAction({ action: HUD_ACTION.SEEK_REL, deltaSeconds: 15 })),
      mkBtn('M13 6v12l8.5-6L13 6zm-1 6L3.5 6v12L12 12z', 'Next paragraph', () => onAction({ action: HUD_ACTION.NEXT })),
      mkBtn('M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7l-1.4-1.4L9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z', 'Stop', () => onAction({ action: HUD_ACTION.STOP })),
    );

    progressEl = document.createElement('div');
    progressEl.style.cssText = 'height:6px;border-radius:999px;background:#374151;overflow:hidden;';
    const bar = document.createElement('div');
    bar.setAttribute('data-tts-progress-bar', 'true');
    bar.style.cssText = 'height:100%;width:0;background:#60a5fa;';
    progressEl.append(bar);

    snippetEl = document.createElement('div');
    snippetEl.style.cssText = 'margin-top:8px;opacity:0.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

    root.append(statusRow, controls, progressEl, snippetEl);
    document.documentElement.append(root);
  }

  function setVisible(next) {
    ensureMounted();
    visible = next;
    root.style.display = visible ? 'block' : 'none';
  }

  function clearHighlight() {
    if (activeNode) {
      activeNode.removeAttribute(HIGHLIGHT_ATTR);
      activeNode.style.outline = '';
      activeNode.style.outlineOffset = '';
    }
    activeNode = null;
  }

  function setActiveNode(node, autoScrollEnabled) {
    clearHighlight();
    if (!node || !node.isConnected) return;
    activeNode = node;
    activeNode.setAttribute(HIGHLIGHT_ATTR, 'true');
    activeNode.style.outline = '2px solid #60a5fa';
    activeNode.style.outlineOffset = '3px';
    if (autoScrollEnabled) {
      autoScroller.scrollNodeIntoView(activeNode);
    }
  }

  function onSessionUpdate(update, snippet = '') {
    ensureMounted();
    if (!update) return;
    const status = update.status;
    if (status === SESSION_STATUS.STOPPED || status === SESSION_STATUS.IDLE) {
      clearHighlight();
      setVisible(false);
      return;
    }

    setVisible(true);
    statusEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);

    const progress = update.duration > 0 ? Math.max(0, Math.min(100, (update.currentTime / update.duration) * 100)) : 0;
    const bar = progressEl.querySelector('[data-tts-progress-bar="true"]');
    if (bar) bar.style.width = `${progress}%`;

    const iconPath = status === SESSION_STATUS.PAUSED
      ? 'M8 5v14l11-7z'
      : 'M6 4h4v16H6V4zm8 0h4v16h-4V4z';
    playPauseAction = status === SESSION_STATUS.PAUSED ? HUD_ACTION.RESUME : HUD_ACTION.PAUSE;
    playPauseButton.innerHTML = '';
    playPauseButton.append(createIcon(iconPath));

    snippetEl.textContent = snippet;
  }

  function onHudError(message) {
    ensureMounted();
    setVisible(true);
    statusEl.textContent = 'Error';
    snippetEl.textContent = message || 'Playback error';
  }

  return {
    onSessionUpdate,
    onHudError,
    setActiveNode,
    hide: () => setVisible(false),
    clearHighlight: () => {
      clearHighlight();
    },
  };
}
