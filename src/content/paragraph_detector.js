const READABLE_TEXT_MIN_LENGTH = 60;
const DEDUPE_MARKER_ATTR = 'data-tts-processed';
const TTS_ID_ATTR = 'data-tts-id';
const BASE_SELECTOR = 'article p, article li, article blockquote, main p, main li, main blockquote, p, li, blockquote, div';
const EXCLUDED_CONTAINER_SELECTOR = 'nav, footer, aside, button, form, [aria-hidden="true"], [hidden], [inert]';
const BLOCKISH_SELECTOR = 'p, li, blockquote, pre, td, section, article, div';

function extractReadableText(node) {
  if (!node || !(node instanceof Element)) {
    return '';
  }

  return node.innerText
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function hasVisibleComputedStyle(node) {
  if (!node || !(node instanceof Element)) {
    return false;
  }

  const style = window.getComputedStyle(node);
  if (!style) {
    return false;
  }

  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }

  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isReadableNode(node, minLength = READABLE_TEXT_MIN_LENGTH) {
  if (!node || !(node instanceof Element)) {
    return false;
  }

  if (node.matches(EXCLUDED_CONTAINER_SELECTOR) || node.closest(EXCLUDED_CONTAINER_SELECTOR)) {
    return false;
  }

  if (!hasVisibleComputedStyle(node)) {
    return false;
  }

  const text = extractReadableText(node);
  if (!text || text.length < minLength) {
    return false;
  }

  return true;
}

function hasReadableChild(node, minLength = READABLE_TEXT_MIN_LENGTH) {
  return Array.from(node.querySelectorAll(BLOCKISH_SELECTOR)).some((child) => {
    if (child === node) {
      return false;
    }

    return isReadableNode(child, minLength);
  });
}

function assignStableTtsId(node, index) {
  if (!node.getAttribute(TTS_ID_ATTR)) {
    node.setAttribute(TTS_ID_ATTR, `tts-${index}`);
  }
}

function detectReadableParagraphs(root = document) {
  const candidateNodes = Array.from(root.querySelectorAll(BASE_SELECTOR));

  const filtered = candidateNodes.filter((node) => {
    if (node.hasAttribute(DEDUPE_MARKER_ATTR)) {
      return false;
    }

    if (!isReadableNode(node)) {
      return false;
    }

    // Prefer leaf-most readable blocks (reject nested duplicates).
    if (hasReadableChild(node)) {
      return false;
    }

    return true;
  });

  filtered.forEach((node, index) => {
    node.setAttribute(DEDUPE_MARKER_ATTR, '1');
    assignStableTtsId(node, index);
  });

  return filtered;
}

if (typeof module !== 'undefined') {
  module.exports = {
    READABLE_TEXT_MIN_LENGTH,
    DEDUPE_MARKER_ATTR,
    TTS_ID_ATTR,
    extractReadableText,
    isReadableNode,
    detectReadableParagraphs,
  };
}
