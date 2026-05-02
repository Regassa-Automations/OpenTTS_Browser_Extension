# AGENTS.md

## Scope
Applies to `src/options/` and all subdirectories.

## Options Layer Mission
Provide a clear, safe configuration UI for TTS settings, budget controls, and usage visibility.

## Non-Negotiable Rules
- Settings read/write must use shared storage helpers (`src/shared/storage.js`).
- Do not duplicate storage key literals in options code; import shared constants.
- Validate all user inputs before save.
- Never log or expose API keys in plaintext diagnostics.
- Keep privacy disclosure present and accurate.

## Required Settings Coverage
The UI must support editing/displaying at least:
- API key
- model
- voice
- monthly budget (USD)
- warning thresholds
- hard stop at limit
- minimum readable chars
- auto-scroll enabled
- prefetch controls (delay/progress/listen thresholds)

## Validation Rules
- Numeric fields must parse to finite numbers and remain in valid ranges.
- Warning thresholds must be ordered ascending and within [0, 1].
- Budget must be non-negative.
- Minimum readable chars must be sensible positive integer.
- Prefetch thresholds:
  - delay/listen ms >= 0
  - progress threshold within [0, 1]
- On validation failure:
  - block save
  - show actionable inline error text
  - do not partially persist invalid state

## UX Rules
- Load settings on page open and render defaults if missing.
- Show explicit save success/error feedback.
- Keep forms responsive; disable Save only during in-flight save.
- Use clear labels and helper text for cost-impacting options.
- Include a visible usage section with current month key and totals.
- Provide reset usage control with confirmation guard.

## Privacy & Security
- API key input should be masked by default.
- Do not echo full API key back in status text.
- No external telemetry calls from options page unless explicitly specified.
- Keep any diagnostics non-PII and minimal.

## Integration Contracts
- Respect default model fallback behavior expected by background adapter.
- Ensure saved settings are compatible with background budget/prefetch logic.
- If new settings are introduced, ensure shared defaults auto-fill on read.

## Accessibility
- Inputs must have associated labels.
- Error states should be programmatically associated with fields.
- Keyboard navigation must remain intact for save/reset workflows.

## Validation Checklist
For changes in this scope, verify:
- Settings load correctly from storage defaults.
- Valid edits persist and reload correctly.
- Invalid edits are blocked with clear messages.
- Usage display renders current bucket values.
- Reset usage action works and updates UI.
- Privacy disclosure text remains visible and accurate.