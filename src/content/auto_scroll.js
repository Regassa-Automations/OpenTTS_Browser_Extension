const SUPPRESS_MS = 800;

export function createAutoScroller({ suppressMs = SUPPRESS_MS } = {}) {
  let suppressUntil = 0;
  let attached = false;

  function markManualInput() {
    suppressUntil = Date.now() + suppressMs;
  }

  function attachListeners() {
    if (attached) return;
    attached = true;

    window.addEventListener('wheel', markManualInput, { passive: true, capture: true });
    window.addEventListener('touchmove', markManualInput, { passive: true, capture: true });
    window.addEventListener('scroll', markManualInput, { passive: true, capture: true });
  }

  function hasUserSelection() {
    const selection = window.getSelection?.();
    return Boolean(selection && !selection.isCollapsed && String(selection).trim().length > 0);
  }

  function shouldAutoScroll() {
    if (document.visibilityState !== 'visible') return false;
    if (hasUserSelection()) return false;
    return Date.now() >= suppressUntil;
  }

  function scrollNodeIntoView(node) {
    attachListeners();
    if (!node || !node.isConnected) return false;
    if (!shouldAutoScroll()) return false;
    node.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    return true;
  }

  return {
    scrollNodeIntoView,
    shouldAutoScroll,
  };
}
