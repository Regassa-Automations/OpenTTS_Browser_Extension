import { buildReadableParagraphRecords } from './paragraph_detector.js';

const DEFAULT_DEBOUNCE_MS = 250;
const BUTTON_ATTR = 'data-tts-control';
const ID_ATTR = 'data-tts-id';

function createPageSessionPrefix() {
  return `tts-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createButtonInjector({
  root = document,
  settings = {},
  onPlayClick = () => {},
  debounceMs = DEFAULT_DEBOUNCE_MS,
} = {}) {
  const pageSessionPrefix = createPageSessionPrefix();
  let nextId = 1;
  let observer = null;
  let debounceTimer = null;

  function getOrAssignTtsId(node) {
    if (!node.dataset.ttsId) {
      node.dataset.ttsId = `${pageSessionPrefix}-${nextId}`;
      nextId += 1;
    }
    return node.dataset.ttsId;
  }

  function makeButton(ttsId, node) {
    const button = document.createElement('span');
    button.setAttribute(BUTTON_ATTR, 'play');
    button.setAttribute('aria-label', 'Play text to speech for this paragraph');
    button.title = 'Play paragraph';

    const shadow = button.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      button {
        all: unset;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 999px;
        border: 1px solid rgba(0,0,0,0.15);
        background: rgba(255,255,255,0.96);
        cursor: pointer;
      }
      button:hover { background: #f4f4f4; }
      button:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
      svg { width: 14px; height: 14px; fill: #111827; }
    `;
    const innerButton = document.createElement('button');
    innerButton.type = 'button';
    innerButton.setAttribute('part', 'trigger');
    innerButton.setAttribute('aria-label', 'Play text to speech for this paragraph');
    innerButton.title = 'Play paragraph';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M8 5v14l11-7z');
    svg.append(path);
    innerButton.append(svg);
    innerButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onPlayClick({ ttsId, node });
    });

    shadow.append(style, innerButton);

    return button;
  }

  function ensureControl(node) {
    getOrAssignTtsId(node);

    const existing = node.querySelector(`:scope > [${BUTTON_ATTR}="play"]`);
    if (existing) return;

    const button = makeButton(node.dataset.ttsId, node);
    // Append control to reduce disruption to the start of readable text.
    node.append(button);
  }

  function injectNow() {
    const paragraphs = buildReadableParagraphRecords({ root, settings });
    paragraphs.forEach(({ node }) => ensureControl(node));
  }

  function scheduleInject() {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(injectNow, debounceMs);
  }



  function shouldProcessMutations(mutations) {
    return mutations.some((mutation) => {
      if (mutation.type === 'characterData') {
        const parent = mutation.target?.parentElement;
        return !(parent && parent.closest(`[${BUTTON_ATTR}]`));
      }

      const touchedNodes = [
        ...Array.from(mutation.addedNodes || []),
        ...Array.from(mutation.removedNodes || []),
      ];

      return touchedNodes.some((n) => {
        if (!(n instanceof Element)) return false;
        if (n.hasAttribute?.(BUTTON_ATTR) || n.closest?.(`[${BUTTON_ATTR}]`)) return false;
        return true;
      });
    });
  }

  function start() {
    if (observer) return;

    injectNow();
    observer = new MutationObserver((mutations) => {
      if (!shouldProcessMutations(mutations)) return;
      scheduleInject();
    });
    observer.observe(root.body || root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function stop() {
    if (observer) observer.disconnect();
    observer = null;
    if (debounceTimer) window.clearTimeout(debounceTimer);
  }

  function getReadableQueueSnapshot() {
    const records = buildReadableParagraphRecords({ root, settings });
    return records.map(({ node, text }) => ({
      ttsId: getOrAssignTtsId(node),
      text,
      node,
    }));
  }

  return {
    start,
    stop,
    injectNow,
    getReadableQueueSnapshot,
    idAttribute: ID_ATTR,
  };
}
