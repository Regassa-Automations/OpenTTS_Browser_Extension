import { HUD_ACTION, SESSION_STATUS } from '../shared/message_types.js';

const HIGHLIGHT_ATTR = 'data-tts-active';

function createIcon(label) {
  const span = document.createElement('span');
  span.setAttribute('aria-hidden', 'true');
  span.textContent = label;
  return span;
}

export function createHudController({ onAction = () => {} } = {}) {
  let root;
  let statusEl;
  let progressEl;
  let snippetEl;
  let playPauseButton;
  let visible = false;
  let activeNode = null;

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

    function mkBtn(label, title, cb) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = title;
      btn.setAttribute('aria-label', title);
      btn.style.cssText = 'border:1px solid rgba(255,255,255,0.25);background:#1f2937;color:#fff;border-radius:8px;padding:6px 8px;cursor:pointer;';
      btn.append(createIcon(label));
      btn.addEventListener('click', cb);
      return btn;
    }

    controls.append(
      mkBtn('⏮', 'Previous paragraph', () => onAction({ action: HUD_ACTION.PREV })),
      mkBtn('↺15', 'Rewind 15 seconds', () => onAction({ action: HUD_ACTION.SEEK_REL, deltaSeconds: -15 })),
    );
    playPauseButton = mkBtn('⏸', 'Pause or resume', () => onAction({ action: HUD_ACTION.PAUSE }));
    controls.append(playPauseButton);
    controls.append(
      mkBtn('15↻', 'Forward 15 seconds', () => onAction({ action: HUD_ACTION.SEEK_REL, deltaSeconds: 15 })),
      mkBtn('⏭', 'Next paragraph', () => onAction({ action: HUD_ACTION.NEXT })),
      mkBtn('✕', 'Stop', () => onAction({ action: HUD_ACTION.STOP })),
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
    if (activeNode) activeNode.removeAttribute(HIGHLIGHT_ATTR);
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
      activeNode.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }
  }

  function clearInlineOutline() {
    if (activeNode) {
      activeNode.style.outline = '';
      activeNode.style.outlineOffset = '';
    }
  }

  function onSessionUpdate(update, snippet = '') {
    ensureMounted();
    if (!update) return;
    const status = update.status;
    if (status === SESSION_STATUS.STOPPED || status === SESSION_STATUS.IDLE) {
      clearHighlight();
      clearInlineOutline();
      setVisible(false);
      return;
    }

    setVisible(true);
    statusEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);

    const progress = update.duration > 0 ? Math.max(0, Math.min(100, (update.currentTime / update.duration) * 100)) : 0;
    const bar = progressEl.querySelector('[data-tts-progress-bar="true"]');
    if (bar) bar.style.width = `${progress}%`;

    playPauseButton.firstChild.textContent = status === SESSION_STATUS.PAUSED ? '▶' : '⏸';
    playPauseButton.onclick = () => onAction({ action: status === SESSION_STATUS.PAUSED ? HUD_ACTION.RESUME : HUD_ACTION.PAUSE });

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
      clearInlineOutline();
      clearHighlight();
    },
  };
}
