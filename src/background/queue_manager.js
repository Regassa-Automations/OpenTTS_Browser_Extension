// Queue manager for paragraph-level playback.

const SEEK_OFFSET_FROM_END_SECONDS = 15;

const queueState = {
  items: [],
  currentIndex: 0,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getCurrentItem() {
  return queueState.items[queueState.currentIndex] || null;
}

function sendOffscreenMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function playQueueIndex(index, startAt = 0) {
  const item = queueState.items[index];
  if (!item) return;

  queueState.currentIndex = index;
  sendOffscreenMessage({
    type: 'OFFSCREEN_SET_SRC',
    src: item.audioUrl,
    startAt,
  });
}

function handleSeekUnderflow(event) {
  const previousIndex = queueState.currentIndex - 1;

  if (previousIndex < 0) {
    sendOffscreenMessage({
      type: 'OFFSCREEN_SEEK',
      deltaSeconds: -event.currentTime,
    });
    return;
  }

  const previousItem = queueState.items[previousIndex];
  const duration = Number(previousItem?.durationSeconds) || 0;
  const startAt = clamp(duration - SEEK_OFFSET_FROM_END_SECONDS, 0, duration);

  playQueueIndex(previousIndex, startAt);
}

function handleSeekOverflow(_event) {
  const nextIndex = queueState.currentIndex + 1;
  if (nextIndex >= queueState.items.length) return;

  playQueueIndex(nextIndex, 0);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'QUEUE_SET_ITEMS') {
    queueState.items = Array.isArray(message.items) ? message.items : [];
    queueState.currentIndex = clamp(message.startIndex || 0, 0, Math.max(queueState.items.length - 1, 0));
    return;
  }

  if (message?.type === 'SEEK_UNDERFLOW') {
    handleSeekUnderflow(message);
    return;
  }

  if (message?.type === 'SEEK_OVERFLOW') {
    handleSeekOverflow(message);
  }
});
