export const STORAGE_KEYS = Object.freeze({
  SETTINGS: 'settings',
  USAGE_BUCKET: 'usageBucket',
});

export const DEFAULT_SETTINGS = Object.freeze({
  apiKey: '',
  model: 'openai/gpt-4o-mini-tts-2025-12-15',
  voice: 'alloy',
  monthlyBudgetUsd: 4.5,
  warnThresholds: [0.8, 0.95, 1.0],
  hardStopAtLimit: true,
  minReadableChars: 40,
  autoScrollEnabled: true,
  prefetchMinDelayMs: 2000,
  prefetchProgressThreshold: 0.5,
  prefetchMinListenMs: 5000,
  singleSessionGlobal: true,
});
