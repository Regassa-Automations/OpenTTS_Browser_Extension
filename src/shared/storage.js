import { DEFAULT_SETTINGS, STORAGE_KEYS } from './storage_keys.js';

function mergeSettingsWithDefaults(raw = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...(raw && typeof raw === 'object' ? raw : {}),
  };
}

function validateSettings(settings) {
  if (!Array.isArray(settings.warnThresholds) || settings.warnThresholds.length !== 3) {
    throw new Error('warnThresholds must be an array of 3 numbers.');
  }

  const [t1, t2, t3] = settings.warnThresholds;
  const thresholds = [t1, t2, t3];

  if (!thresholds.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) {
    throw new Error('warnThresholds values must be finite numbers in [0, 1].');
  }

  if (!(t1 <= t2 && t2 <= t3)) {
    // Non-obvious behavior: ordered thresholds prevent contradictory warning states.
    throw new Error('warnThresholds must be monotonically non-decreasing.');
  }

  if (!Number.isFinite(settings.monthlyBudgetUsd) || settings.monthlyBudgetUsd < 0) {
    throw new Error('monthlyBudgetUsd must be a finite number >= 0.');
  }

  if (!Number.isInteger(settings.minReadableChars) || settings.minReadableChars < 1) {
    throw new Error('minReadableChars must be an integer >= 1.');
  }

  if (!Number.isFinite(settings.prefetchMinDelayMs) || settings.prefetchMinDelayMs < 0) {
    throw new Error('prefetchMinDelayMs must be a finite number >= 0.');
  }

  if (!Number.isFinite(settings.prefetchProgressThreshold) || settings.prefetchProgressThreshold < 0 || settings.prefetchProgressThreshold > 1) {
    throw new Error('prefetchProgressThreshold must be a finite number in [0, 1].');
  }

  if (!Number.isFinite(settings.prefetchMinListenMs) || settings.prefetchMinListenMs < 0) {
    throw new Error('prefetchMinListenMs must be a finite number >= 0.');
  }
}

export async function ensureDefaults() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const merged = mergeSettingsWithDefaults(result[STORAGE_KEYS.SETTINGS]);
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: merged });
  return merged;
}

export async function getSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const merged = mergeSettingsWithDefaults(result[STORAGE_KEYS.SETTINGS]);

  // Auto-fill any newly added settings fields on read.
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: merged });

  return merged;
}

export async function saveSettings(partial = {}) {
  const current = await getSettings();
  const merged = mergeSettingsWithDefaults({ ...current, ...partial });
  validateSettings(merged);
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: merged });
  return merged;
}

export function getCurrentMonthKey(nowMs = Date.now()) {
  const date = new Date(nowMs);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function createEmptyUsageBucket(monthKey) {
  return {
    monthKey,
    characters: 0,
    estimatedUsd: 0,
    updatedAt: Date.now(),
  };
}

export async function getUsageBucket(monthKey = getCurrentMonthKey()) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.USAGE_BUCKET);
  const allBuckets = (result[STORAGE_KEYS.USAGE_BUCKET] && typeof result[STORAGE_KEYS.USAGE_BUCKET] === 'object')
    ? result[STORAGE_KEYS.USAGE_BUCKET]
    : {};

  const bucket = allBuckets[monthKey] || createEmptyUsageBucket(monthKey);

  if (!allBuckets[monthKey]) {
    allBuckets[monthKey] = bucket;
    await chrome.storage.local.set({ [STORAGE_KEYS.USAGE_BUCKET]: allBuckets });
  }

  return bucket;
}

export async function incrementUsage({ charCount = 0, estimatedUsd = 0 } = {}) {
  const safeCharCount = Number.isFinite(charCount) ? Math.max(0, Math.floor(charCount)) : 0;
  const safeEstimatedUsd = Number.isFinite(estimatedUsd) ? Math.max(0, estimatedUsd) : 0;

  const monthKey = getCurrentMonthKey();
  const result = await chrome.storage.local.get(STORAGE_KEYS.USAGE_BUCKET);
  const allBuckets = (result[STORAGE_KEYS.USAGE_BUCKET] && typeof result[STORAGE_KEYS.USAGE_BUCKET] === 'object')
    ? result[STORAGE_KEYS.USAGE_BUCKET]
    : {};

  const current = allBuckets[monthKey] || createEmptyUsageBucket(monthKey);
  const next = {
    monthKey,
    characters: (Number.isFinite(current.characters) ? current.characters : 0) + safeCharCount,
    estimatedUsd: (Number.isFinite(current.estimatedUsd) ? current.estimatedUsd : 0) + safeEstimatedUsd,
    updatedAt: Date.now(),
  };

  allBuckets[monthKey] = next;
  await chrome.storage.local.set({ [STORAGE_KEYS.USAGE_BUCKET]: allBuckets });

  return next;
}

export async function resetUsage(monthKey = getCurrentMonthKey()) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.USAGE_BUCKET);
  const allBuckets = (result[STORAGE_KEYS.USAGE_BUCKET] && typeof result[STORAGE_KEYS.USAGE_BUCKET] === 'object')
    ? result[STORAGE_KEYS.USAGE_BUCKET]
    : {};

  allBuckets[monthKey] = createEmptyUsageBucket(monthKey);
  await chrome.storage.local.set({ [STORAGE_KEYS.USAGE_BUCKET]: allBuckets });

  return allBuckets[monthKey];
}
