import { DEFAULT_SETTINGS } from '../shared/storage_keys.js';
import { getCurrentMonthKey, getSettings, getUsageBucket, resetUsage, saveSettings } from '../shared/storage.js';

const form = document.getElementById('settings-form');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('form-error');
const saveButton = document.getElementById('save');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

function clearErrors() {
  errorEl.textContent = '';
  const fields = form.querySelectorAll('[aria-invalid="true"]');
  fields.forEach((field) => {
    field.removeAttribute('aria-invalid');
    field.removeAttribute('aria-describedby');
  });
}

function markFieldError(field, message) {
  const errorId = `${field.id}-error`;
  let node = document.getElementById(errorId);
  if (!node) {
    node = document.createElement('p');
    node.id = errorId;
    node.className = 'error';
    field.insertAdjacentElement('afterend', node);
  }
  node.textContent = message;
  field.setAttribute('aria-invalid', 'true');
  field.setAttribute('aria-describedby', errorId);
}

function readFormValues() {
  return {
    apiKey: document.getElementById('apiKey').value.trim(),
    model: document.getElementById('model').value.trim(),
    voice: document.getElementById('voice').value.trim(),
    monthlyBudgetUsd: Number(document.getElementById('monthlyBudgetUsd').value),
    warnThresholds: [
      Number(document.getElementById('warn1').value),
      Number(document.getElementById('warn2').value),
      Number(document.getElementById('warn3').value),
    ],
    hardStopAtLimit: document.getElementById('hardStopAtLimit').checked,
    minReadableChars: Number(document.getElementById('minReadableChars').value),
    autoScrollEnabled: document.getElementById('autoScrollEnabled').checked,
    prefetchMinDelayMs: Number(document.getElementById('prefetchMinDelayMs').value),
    prefetchProgressThreshold: Number(document.getElementById('prefetchProgressThreshold').value),
    prefetchMinListenMs: Number(document.getElementById('prefetchMinListenMs').value),
  };
}

function validate(values) {
  clearErrors();
  const errors = [];

  if (!values.model) {
    markFieldError(document.getElementById('model'), 'Model is required.');
    errors.push('Model is required.');
  }
  if (!values.voice) {
    markFieldError(document.getElementById('voice'), 'Voice is required.');
    errors.push('Voice is required.');
  }
  if (!Number.isFinite(values.monthlyBudgetUsd) || values.monthlyBudgetUsd < 0) {
    markFieldError(document.getElementById('monthlyBudgetUsd'), 'Monthly budget must be >= 0.');
    errors.push('Invalid monthly budget.');
  }

  const [w1, w2, w3] = values.warnThresholds;
  const warnsValid = [w1, w2, w3].every((n) => Number.isFinite(n) && n >= 0 && n <= 1) && (w1 <= w2 && w2 <= w3);
  if (!warnsValid) {
    markFieldError(document.getElementById('warn3'), 'Warn thresholds must be ordered and each in [0,1].');
    errors.push('Invalid warning thresholds.');
  }

  if (!Number.isInteger(values.minReadableChars) || values.minReadableChars < 1) {
    markFieldError(document.getElementById('minReadableChars'), 'Minimum readable chars must be an integer >= 1.');
    errors.push('Invalid minimum readable chars.');
  }

  if (!Number.isFinite(values.prefetchMinDelayMs) || values.prefetchMinDelayMs < 0) {
    markFieldError(document.getElementById('prefetchMinDelayMs'), 'Must be >= 0.');
    errors.push('Invalid prefetch delay.');
  }
  if (!Number.isFinite(values.prefetchProgressThreshold) || values.prefetchProgressThreshold < 0 || values.prefetchProgressThreshold > 1) {
    markFieldError(document.getElementById('prefetchProgressThreshold'), 'Must be in [0,1].');
    errors.push('Invalid prefetch progress threshold.');
  }
  if (!Number.isFinite(values.prefetchMinListenMs) || values.prefetchMinListenMs < 0) {
    markFieldError(document.getElementById('prefetchMinListenMs'), 'Must be >= 0.');
    errors.push('Invalid prefetch listen threshold.');
  }

  if (errors.length) {
    errorEl.textContent = 'Please fix the highlighted fields before saving.';
    return false;
  }

  return true;
}

function renderSettings(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  document.getElementById('apiKey').value = merged.apiKey || '';
  document.getElementById('model').value = merged.model;
  document.getElementById('voice').value = merged.voice;
  document.getElementById('monthlyBudgetUsd').value = String(merged.monthlyBudgetUsd);
  document.getElementById('warn1').value = String(merged.warnThresholds[0]);
  document.getElementById('warn2').value = String(merged.warnThresholds[1]);
  document.getElementById('warn3').value = String(merged.warnThresholds[2]);
  document.getElementById('hardStopAtLimit').checked = Boolean(merged.hardStopAtLimit);
  document.getElementById('minReadableChars').value = String(merged.minReadableChars);
  document.getElementById('autoScrollEnabled').checked = Boolean(merged.autoScrollEnabled);
  document.getElementById('prefetchMinDelayMs').value = String(merged.prefetchMinDelayMs);
  document.getElementById('prefetchProgressThreshold').value = String(merged.prefetchProgressThreshold);
  document.getElementById('prefetchMinListenMs').value = String(merged.prefetchMinListenMs);
}

async function loadUsage() {
  const monthKey = getCurrentMonthKey();
  const usage = await getUsageBucket(monthKey);
  document.getElementById('usage-month').textContent = monthKey;
  document.getElementById('usage-characters').textContent = String(usage.characters);
  document.getElementById('usage-usd').textContent = `$${Number(usage.estimatedUsd || 0).toFixed(4)}`;
}

async function loadAll() {
  const settings = await getSettings();
  renderSettings(settings);
  await loadUsage();
  setStatus('Settings loaded.');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = readFormValues();
  if (!validate(values)) {
    setStatus('Validation failed.', true);
    return;
  }

  saveButton.disabled = true;
  try {
    await saveSettings(values);
    setStatus('Settings saved.');
  } catch (error) {
    errorEl.textContent = 'Unable to save settings. Please check values and retry.';
    setStatus('Save failed.', true);
  } finally {
    saveButton.disabled = false;
  }
});

document.getElementById('reload').addEventListener('click', () => {
  loadAll().catch(() => setStatus('Unable to reload settings.', true));
});

document.getElementById('reset-usage').addEventListener('click', async () => {
  const monthKey = getCurrentMonthKey();
  const confirmed = window.confirm(`Reset usage for ${monthKey}?`);
  if (!confirmed) {
    return;
  }

  await resetUsage(monthKey);
  await loadUsage();
  setStatus('Usage reset.');
});

loadAll().catch(() => {
  setStatus('Unable to load settings.', true);
});
