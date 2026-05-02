const CANDIDATE_SELECTOR = 'p, li, article section';
const EXCLUDED_ANCESTOR_SELECTOR = 'nav, footer, aside, form, button, [aria-hidden="true"]';
const DEFAULT_MIN_READABLE_CHARS = 40;

function getMinChars(settings = {}) {
  const value = Number(settings?.minReadableChars);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_MIN_READABLE_CHARS;
}

function isVisibleNode(element) {
  if (!(element instanceof Element)) return false;

  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  return true;
}

function isExcluded(element) {
  return Boolean(element.closest(EXCLUDED_ANCESTOR_SELECTOR));
}

function getReadableText(element) {
  return (element.textContent || '').replace(/\s+/g, ' ').trim();
}

function dedupeLeafMost(nodes) {
  const accepted = [];

  for (const node of nodes) {
    if (accepted.some((existing) => existing.contains(node))) {
      continue;
    }

    for (let i = accepted.length - 1; i >= 0; i -= 1) {
      if (node.contains(accepted[i])) {
        accepted.splice(i, 1);
      }
    }

    accepted.push(node);
  }

  return accepted;
}

export function detectReadableNodes({ root = document, settings = {} } = {}) {
  const minChars = getMinChars(settings);
  const candidates = Array.from(root.querySelectorAll(CANDIDATE_SELECTOR));

  const readable = candidates.filter((element) => {
    if (!(element instanceof HTMLElement)) return false;
    if (isExcluded(element)) return false;
    if (!isVisibleNode(element)) return false;

    const text = getReadableText(element);
    return text.length >= minChars;
  });

  const leafMost = dedupeLeafMost(readable);
  // Ensure deterministic DOM-order output for downstream queue payloads.
  leafMost.sort((a, b) => {
    if (a === b) return 0;
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

  return leafMost;
}

export function buildReadableParagraphRecords({ root = document, settings = {} } = {}) {
  const nodes = detectReadableNodes({ root, settings });

  return nodes.map((node) => ({
    node,
    text: getReadableText(node),
  }));
}
