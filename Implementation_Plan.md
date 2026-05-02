# OpenTTS Browser Extension v1.3 — Step-by-Step Implementation Plan

## Step 1) Scaffold/validate architecture and shared contracts

### Tasks
- Validate directory/file layout matches the design doc.
- Ensure `manifest.json` has all required MV3 entries, permissions, and host permissions.
- Implement/normalize shared constants and message contracts in:
  - `src/shared/message_types.js`
  - `src/shared/storage_keys.js`
  - `src/shared/storage.js`

### Detailed Agent Prompt
Implement the architecture baseline for OpenTTS Browser Extension v1.3.

Requirements:
- Confirm the project layout follows:
  - `src/shared/*`, `src/background/*`, `src/content/*`, `src/offscreen/*`, `src/options/*`.
- Update `manifest.json` to satisfy MV3 requirements:
  - `manifest_version: 3`
  - `background service worker: src/background/service_worker.js`
  - permissions include: `storage`, `activeTab`, `scripting`, `offscreen`, `tabs`, `contextMenus`, `alarms`
  - host permissions include: `https://openrouter.ai/*`
  - content script registration
  - options page registration: `src/options/options.html`
- In `src/shared/message_types.js`, define canonical message names and enums from v1.3:
  - content->bg: `CONTENT_START_SESSION`, `CONTENT_HUD_ACTION`
  - bg->content: `BG_SESSION_UPDATE`, `BG_HUD_ERROR`
  - bg->offscreen: `OFFSCREEN_PLAY`, `OFFSCREEN_PAUSE`, `OFFSCREEN_RESUME`, `OFFSCREEN_SEEK_REL`, `OFFSCREEN_STOP`
  - offscreen->bg: `OFFSCREEN_AUDIO_TIME`, `OFFSCREEN_AUDIO_ENDED`, `OFFSCREEN_AUDIO_STATE`, `OFFSCREEN_SEEK_UNDERFLOW`, `OFFSCREEN_SEEK_OVERFLOW`, `OFFSCREEN_AUDIO_ERROR`
  - enums for `SESSION_STATUS`, `HUD_ACTION`, `SESSION_REASON`, `ERROR_CODE`
- In `src/shared/storage_keys.js`, define defaults exactly per v1.3 settings.
- In `src/shared/storage.js`, implement:
  - `ensureDefaults`, `getSettings`, `saveSettings`, `getCurrentMonthKey`, `getUsageBucket`, `incrementUsage`, `resetUsage`
  - auto-fill missing settings fields on read
  - validation for threshold ordering/ranges before save

Deliverables:
- Updated manifest + shared modules with consistent exports/imports.
- Inline comments for any non-obvious validation behavior.

## Step 2) Build OpenRouter adapter as the single provider integration point

### Tasks
- Implement `src/background/openrouter_client.js` as the only OpenRouter caller.
- Enforce normalized adapter response (`audioDataUrl`, `mimeType`, `charCount`, `modelUsed`, `voiceUsed`).
- Implement required error mapping and basic cost estimation.

### Detailed Agent Prompt
Implement `src/background/openrouter_client.js` as the sole TTS provider adapter.

Requirements:
- Export:
  - `buildTtsRequest({ text, voice, model, format })`
  - `fetchTtsAudio({ apiKey, text, voice, model })`
  - `parseTtsResponse(raw)`
  - `estimateCost({ charCount, model })`
- Default model fallback: `openai/gpt-4o-mini-tts` when invalid/empty override.
- Normalize successful output:
  - `audioDataUrl`, `mimeType`, `charCount`, `modelUsed`, `voiceUsed`
- Map errors strictly:
  - `401/403 => AUTH_ERROR`
  - `402 => QUOTA_ERROR`
  - `429 => RATE_LIMIT`
  - `400 => BAD_REQUEST`
  - `5xx => UPSTREAM_ERROR`
  - parse fail => `PARSE_ERROR`
  - network fail => `NETWORK_ERROR`
- Keep parser resilient to response format variation and include safe debug metadata (non-PII) where practical.

Deliverables:
- Adapter module with clear JSDoc and deterministic error objects used by service worker.

## Step 3) Implement background service worker orchestration + global single-session policy

### Tasks
- Implement global state maps and active-session pointer in `service_worker.js`.
- Implement `CONTENT_START_SESSION`, `CONTENT_HUD_ACTION`, and offscreen event handlers.
- Enforce single active session across tabs with `superseded_by_new_tab` behavior.
- Implement latency-first flow (dispatch TTS immediately, HUD loading in parallel).

### Detailed Agent Prompt
Implement the main orchestrator in `src/background/service_worker.js`.

Requirements:
- Maintain in-memory state:
  - `activeSessionRef`
  - `sessionsByTab`
  - `prefetchStateBySession`
  - `cacheByKey`
  - `inFlightByKey`
- Implement helper methods:
  - `startSessionFromContent(payload, senderTabId)`
  - `stopSession(tabId, reason)`
  - `playSessionIndex(session, index, opts?)`
  - `broadcastSessionUpdate(session, patch?)`
  - `handleAudioTime(session, { currentTime, duration })`
  - `evaluatePrefetchGate(session, progressMeta)`
  - `invalidateSessionPrefetch(sessionId)`
- On `CONTENT_START_SESSION`:
  - validate sender/payload
  - if another tab has active session and global single-session enabled, stop old session/offscreen, emit stop reason `superseded_by_new_tab`, clear old prefetch state
  - create/replace session for current tab
  - budget check
  - dispatch TTS request immediately
  - emit loading update
  - on TTS response, command offscreen play + emit playing
  - initialize deferred prefetch gate tracking
- On `CONTENT_HUD_ACTION`, implement `PREV/NEXT/PAUSE/RESUME/SEEK_REL/STOP` semantics.
- On offscreen events, implement time updates, auto-advance, seek boundary handling, and error transitions.

Deliverables:
- Fully wired service-worker message routing and lifecycle transitions.

## Step 4) Implement offscreen audio runtime and boundary event semantics

### Tasks
- Implement offscreen document and audio element control (`offscreen.html`, `offscreen.js`).
- Handle play/pause/resume/seek/stop commands from background.
- Emit time, ended, state, seek underflow/overflow, and error events.

### Detailed Agent Prompt
Implement offscreen playback runtime in `src/offscreen/offscreen.html` and `src/offscreen/offscreen.js`.

Requirements:
- Host one `HTMLAudioElement`.
- Receive bg commands:
  - `OFFSCREEN_PLAY`, `OFFSCREEN_PAUSE`, `OFFSCREEN_RESUME`, `OFFSCREEN_SEEK_REL`, `OFFSCREEN_STOP`
- Emit events back:
  - `OFFSCREEN_AUDIO_TIME`, `OFFSCREEN_AUDIO_ENDED`, `OFFSCREEN_AUDIO_STATE`, `OFFSCREEN_SEEK_UNDERFLOW`, `OFFSCREEN_SEEK_OVERFLOW`, `OFFSCREEN_AUDIO_ERROR`
- Seek semantics:
  - If relative seek goes below 0, emit underflow event (don’t perform queue transition locally).
  - If seek passes duration, emit overflow event.
- Keep queue transition decisions in background only.

Deliverables:
- Stable offscreen audio engine with strict responsibility split.

## Step 5) Implement paragraph detection + control injection with dynamic content support

### Tasks
- Build readable node detection in `paragraph_detector.js`.
- Inject one play control per readable node via `button_injector.js`.
- Use shadow DOM and inline SVG icon fallback.
- Add debounced MutationObserver support for infinite-scroll content.

### Detailed Agent Prompt
Implement content readability and control injection in:
- `src/content/paragraph_detector.js`
- `src/content/button_injector.js`

Requirements:
- Start candidate query: `p, li, article section`
- Filter by:
  - non-empty trimmed text
  - min chars (default 40, from settings)
  - visibility/layout checks
  - exclusion zones (`nav`, `footer`, `aside`, `form`, `button`, `[aria-hidden="true"]`)
  - nested dedupe preferring leaf-most readable nodes
- Assign stable page-session `data-tts-id`.
- Inject exactly one play control per readable node.
- Isolate styles via Shadow DOM.
- Use inline SVG icons; extension assets may be optional fallback only.
- Observe dynamic DOM mutations with debounce and idempotent reinjection logic.

Deliverables:
- Deterministic detection/injection pipeline resilient to dynamic page updates.

## Step 6) Build content script session initiation + HUD rendering/interaction

### Tasks
- Implement `content_script.js` orchestration.
- Build HUD UI in `hud.js` with required controls and states.
- Send start-session payload (`paragraphIds`, `textById`, clicked index context) to background.
- Respond to session updates and errors from background.

### Detailed Agent Prompt
Implement content-side orchestration in:
- `src/content/content_script.js`
- `src/content/hud.js`
- optionally `src/content/auto_scroll.js`

Requirements:
- On play click, build ordered queue from clicked paragraph onward and send `CONTENT_START_SESSION`.
- HUD:
  - fixed bottom-center
  - hidden when idle; shown from first playback attempt
  - controls: previous, rewind 15s, play/pause, forward 15s, next, close/stop
  - states: Loading, Playing, Paused, Error, Blocked
  - progress bar + optional snippet
- On close/stop: send stop action, clear highlight, hide HUD.
- Consume `BG_SESSION_UPDATE` and `BG_HUD_ERROR`; keep UI state aligned with session status.
- Implement active paragraph highlighting and optional auto-scroll if enabled.

Deliverables:
- End-to-end interactive playback UX from inline button to HUD controls.

## Step 7) Implement prefetch + cache + budget guardrails

### Tasks
- Implement cache keying and in-flight dedupe in background.
- Implement deferred prefetch gate:
  - 50% consumed OR 5s listened OR 2s delay while still playing
- Enforce monthly budget checks/warnings and hard stop behavior.

### Detailed Agent Prompt
Implement v1.3 performance/cost controls in background modules (`service_worker.js`, and optional extractions like `prefetch_manager.js`, `budget_manager.js`, `queue_manager.js`).

Requirements:
- Cache key format: `${sessionId}:${ttsId}:${voice}:${model}`
- Deduplicate concurrent fetches with `inFlightByKey`.
- Prefetch default depth 1 ahead; optional gated depth 2.
- Trigger prefetch only after one gate passes:
  - `progress >= 0.5` OR `listen >= 5000ms` OR `elapsed >= 2000ms` while playing
- Budget:
  - read monthly bucket usage
  - warn at configured thresholds
  - hard block when limit reached if `hardStopAtLimit=true`
  - emit blocked state/reason to HUD
- Track usage increments by char count + estimated USD.

Deliverables:
- Balanced latency/cost behavior with explicit state transitions.

## Step 8) Implement options page + privacy/usage controls

### Tasks
- Build form/UI for API key, model, voice, budget thresholds, auto-scroll.
- Implement save/load/reset flows via shared storage APIs.
- Display usage bucket and warning/limit configuration.

### Detailed Agent Prompt
Implement options UI in:
- `src/options/options.html`
- `src/options/options.js`
- `src/options/options.css`

Requirements:
- Settings fields:
  - API key
  - model
  - voice
  - monthly budget USD
  - warning thresholds
  - hard stop at limit
  - min readable chars
  - auto-scroll toggle
  - prefetch gate controls (delay/progress/listen)
- Use shared storage helpers and validation.
- Show current monthly usage and include reset control.
- Include privacy disclosure (what is sent upstream and when).

Deliverables:
- Fully functional options surface with persisted validated config.

## Step 9) Integration hardening and acceptance checklist

### Tasks
- Verify message contracts are used consistently across all layers.
- Validate queue/seek/auto-advance edge cases statically.
- Confirm no module except `openrouter_client.js` calls OpenRouter APIs.
- Run manual acceptance checklist against spec behaviors.

### Detailed Agent Prompt
Perform an integration pass across all modules.

Checklist:
- Single-session cross-tab supersede behavior and reason propagation.
- Latency-first startup ordering (request dispatch not blocked by UI).
- Offscreen/background responsibility split for seek boundaries.
- Auto-advance and queue-end stop behavior.
- Prefetch gate logic and cache/in-flight dedupe correctness.
- Budget warning/block state correctness.
- CSP-safe inline SVG usage for controls.
- Adapter exclusivity: only `src/background/openrouter_client.js` performs provider requests.

Deliverables:
- Small set of focused fixes for contract mismatches.
- Final “spec conformance” summary mapping implemented behaviors to v1.3 requirements.

## Suggested execution order (for implementation agents)
- Step 1 → Step 2 → Step 3 → Step 4 (core runtime first)
- Step 5 → Step 6 (content UX path)
- Step 7 → Step 8 (optimization + settings)
- Step 9 (hardening/conformance)
