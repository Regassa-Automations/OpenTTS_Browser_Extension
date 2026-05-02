# OpenTTS Browser Extension — File-by-File Technical Design (v1.3)

## 1) Directory Layout

    src/
      shared/
        message_types.js
        storage_keys.js
        storage.js
        types.js                  (optional JSDoc typedefs)
      background/
        service_worker.js
        openrouter_client.js
        queue_manager.js
        prefetch_manager.js       (new in v1.3, optional but recommended)
        offscreen_manager.js
        budget_manager.js         (optional extraction)
      content/
        content_script.js
        paragraph_detector.js
        button_injector.js
        hud.js
        auto_scroll.js            (new in v1.3, optional extraction)
      offscreen/
        offscreen.html
        offscreen.js
      options/
        options.html
        options.js
        options.css
    manifest.json

---

## 2) Global Contracts (v1.3)

### 2.1 Single Session Policy
- Exactly one active reading session globally across all tabs.
- Starting a new session in Tab B must stop/terminate any existing session in Tab A.
- Prior tab receives status update with reason: `superseded_by_new_tab`.

### 2.2 Latency-First Start
- On user click/start:
  1) Validate settings + budget.
  2) Dispatch TTS request immediately.
  3) Render HUD `Loading` in parallel.
- UI work must not block request dispatch.

### 2.3 Deferred Prefetch Gate
Prefetch next paragraph only after ANY gate passes:
- 50% progress consumed, OR
- 5s listened on current paragraph, OR
- 2s minimum delay elapsed while still `playing`.

### 2.4 CSP-Resilient Controls
- Inline SVG icons embedded in script/template.
- No remote icon dependencies.

---

## 3) `manifest.json`

### Responsibilities
- Configure MV3 extension wiring.
- Declare required permissions and host permissions.
- Register offscreen document support.

### Required fields
- `manifest_version: 3`
- `background.service_worker: "src/background/service_worker.js"`
- `permissions: ["storage","activeTab","scripting","offscreen","tabs","contextMenus","alarms"]`
- `host_permissions: ["https://openrouter.ai/*"]`
- `content_scripts` mapping for web pages
- `options_page: "src/options/options.html"`

### Notes
- Keep web-accessible resources minimal.
- If any local SVG assets are present, inline SVG should still remain primary path.

---

## 4) Shared Layer

## 4.1 `src/shared/message_types.js`

### Responsibilities
- Canonical message/event names and enums.

### Must include

Content -> Background:
- `CONTENT_START_SESSION`
- `CONTENT_HUD_ACTION`

Background -> Content:
- `BG_SESSION_UPDATE`
- `BG_HUD_ERROR`

Background -> Offscreen:
- `OFFSCREEN_PLAY`
- `OFFSCREEN_PAUSE`
- `OFFSCREEN_RESUME`
- `OFFSCREEN_SEEK_REL`
- `OFFSCREEN_STOP`

Offscreen -> Background:
- `OFFSCREEN_AUDIO_TIME`
- `OFFSCREEN_AUDIO_ENDED`
- `OFFSCREEN_AUDIO_STATE`
- `OFFSCREEN_SEEK_UNDERFLOW`
- `OFFSCREEN_SEEK_OVERFLOW`
- `OFFSCREEN_AUDIO_ERROR`

Enums:
- `SESSION_STATUS = idle|loading|playing|paused|stopped|error|blocked`
- `HUD_ACTION = PREV|NEXT|PAUSE|RESUME|SEEK_REL|STOP`
- `SESSION_REASON = superseded_by_new_tab|user_stopped|queue_ended|budget_blocked|error`
- `ERROR_CODE = AUTH_ERROR|QUOTA_ERROR|RATE_LIMIT|BAD_REQUEST|UPSTREAM_ERROR|PARSE_ERROR|NETWORK_ERROR`

### Payload guidance
- Include `sessionId` and `tabId` whenever applicable.
- `BG_SESSION_UPDATE` includes optional `reason`.

---

## 4.2 `src/shared/storage_keys.js`

### Responsibilities
- Storage key constants and default settings.

### Keys
- `STORAGE_KEYS.SETTINGS`
- `STORAGE_KEYS.USAGE_BUCKET`

### Default settings (v1.3)
- `model = "openai/gpt-4o-mini-tts"`
- `voice = "<default voice id>"`
- `monthlyBudgetUsd = 4.5`
- `warnThresholds = [0.8, 0.95, 1.0]`
- `hardStopAtLimit = true`
- `minReadableChars = 40`
- `autoScrollEnabled = true`
- `prefetchMinDelayMs = 2000`
- `prefetchProgressThreshold = 0.5`
- `prefetchMinListenMs = 5000`
- `singleSessionGlobal = true`

---

## 4.3 `src/shared/storage.js`

### Responsibilities
- Read/write settings and usage with defaults.
- Utility for month-bucket accounting.

### API
- `ensureDefaults()`
- `getSettings()`
- `saveSettings(partial)`
- `getCurrentMonthKey(nowMs?)` -> `YYYY-MM` (UTC)
- `getUsageBucket(monthKey?)`
- `incrementUsage({ charCount, estimatedUsd })`
- `resetUsage(monthKey?)`

### v1.3 Notes
- Any missing new setting fields are auto-filled on read.
- Validate threshold ordering and numeric ranges before save.

---

## 5) Background Layer

## 5.1 `src/background/service_worker.js`

### Responsibilities
- Main orchestrator and state authority.
- Enforce global single-session policy.
- Run latency-first start sequence.
- Route messages across content and offscreen.
- Manage session lifecycle per tab.

### In-memory state
- `activeSessionRef` (global pointer to current active session/tab)
- `sessionsByTab: Map<tabId, Session>`
- `prefetchStateBySession: Map<sessionId, PrefetchState>`
- `cacheByKey: Map<cacheKey, AudioCacheEntry>`
- `inFlightByKey: Map<cacheKey, Promise<TtsResult>>`

### Core flows

#### A) Start session (`CONTENT_START_SESSION`)
1. Resolve tab + payload validity.
2. If `singleSessionGlobal` true and another session exists:
   - stop old session via offscreen
   - emit update to old tab with `reason = superseded_by_new_tab`
   - clear old prefetch timers/state
3. Create/replace session for current tab.
4. Budget check.
5. Dispatch TTS fetch immediately (do not await HUD render).
6. Emit `loading` update.
7. On audio response, command offscreen play and emit `playing`.
8. Initialize deferred prefetch gate tracking.

#### B) HUD actions (`CONTENT_HUD_ACTION`)
- `PREV/NEXT`: queue move + immediate play path.
- `PAUSE/RESUME`: offscreen pass-through + status update.
- `SEEK_REL`: offscreen pass-through.
- `STOP`: stop offscreen, clear session.

#### C) Offscreen events
- `AUDIO_TIME`: update progress; evaluate prefetch gate.
- `AUDIO_ENDED`: auto-advance.
- `SEEK_UNDERFLOW/OVERFLOW`: queue boundary transitions.
- `AUDIO_ERROR`: transition to `error`, emit retry-capable UI state.

### Required helper methods
- `startSessionFromContent(payload, senderTabId)`
- `stopSession(tabId, reason)`
- `playSessionIndex(session, index, opts?)`
- `broadcastSessionUpdate(session, patch?)`
- `handleAudioTime(session, {currentTime,duration})`
- `evaluatePrefetchGate(session, progressMeta)`
- `invalidateSessionPrefetch(sessionId)`

---

## 5.2 `src/background/openrouter_client.js`

### Responsibilities
- Sole OpenRouter integration adapter.
- Build request payload, execute fetch, parse response, map errors.

### API
- `buildTtsRequest({ text, voice, model, format })`
- `fetchTtsAudio({ apiKey, text, voice, model })`
- `parseTtsResponse(raw)`
- `estimateCost({ charCount, model })`

### Return shape
- `audioDataUrl`
- `mimeType`
- `charCount`
- `modelUsed`
- `voiceUsed`

### Error mapping
- 401/403 => `AUTH_ERROR`
- 402 => `QUOTA_ERROR`
- 429 => `RATE_LIMIT`
- 400 => `BAD_REQUEST`
- 5xx => `UPSTREAM_ERROR`
- parse fail => `PARSE_ERROR`
- network fail => `NETWORK_ERROR`

### v1.3 Notes
- Keep response parser robust to provider format evolution.
- Include request id/debug metadata when possible for diagnostics (non-PII).

---

## 5.3 `src/background/queue_manager.js`

### Responsibilities
- Pure queue logic (no Chrome API side effects).

### API
- `createSession({ tabId, paragraphIds, textById, startTtsId, voice, model })`
- `getCurrent(session)`
- `hasPrev/hasNext(session)`
- `movePrev/moveNext(session)`
- `setIndex(session, idx)`
- `buildCacheKey(session, ttsId)`

### v1.3 Rules
- Holds no async logic.
- Deterministic transitions for underflow/overflow handling.

---

## 5.4 `src/background/prefetch_manager.js` (recommended extraction)

### Responsibilities
- Encapsulate deferred prefetch gate and timer lifecycle.
- Prevent wasted calls during rapid hopping.

### Prefetch state per session
- `startedAtMs`
- `prefetchTriggered: boolean`
- `gateTimerId: number | null`
- `lastProgress: number`
- `lastCurrentTime: number`
- `cancelToken/version`

### API
- `initPrefetchState(sessionId, settings)`
- `onTrackStart(sessionId, nowMs)`
- `onAudioTime(sessionId, {currentTime,duration}, nowMs)`
- `maybeTriggerPrefetch(session, deps)`
- `cancelPrefetchState(sessionId)`
- `markSessionVersion(sessionId, version)` (stale result guard)

### Gate logic
Trigger when any condition true:
- `progress >= prefetchProgressThreshold`
- `currentTimeMs >= prefetchMinListenMs`
- `now - trackStart >= prefetchMinDelayMs` AND still playing

### Anti-waste behavior
- Cancel timers on skip/pause/stop/session replace.
- Drop results if session/version no longer current.

---

## 5.5 `src/background/offscreen_manager.js`

### Responsibilities
- Ensure single offscreen document exists.
- Send command messages safely.

### API
- `ensureOffscreenDocument()`
- `sendToOffscreen(type, payload)`
- `closeOffscreenIfIdle()` (optional)

### Notes
- Use singleton creation promise to avoid race conditions.

---

## 5.6 `src/background/budget_manager.js` (optional extraction)

### Responsibilities
- Budget threshold checks and status generation.

### API
- `computeBudgetState({usageUsd, budgetUsd, thresholds})`
- `canStartNewRequest(settings, usage)`
- `formatBudgetWarning(state)`

### States
- `ok`, `warn80`, `warn95`, `blocked100`

---

## 6) Content Layer

## 6.1 `src/content/content_script.js`

### Responsibilities
- Boot detector, injector, HUD, observers.
- Build session payload on play click.
- Render updates from background.
- Trigger auto-scroll on paragraph changes (if enabled).

### Startup sequence
1. Load settings subset (`minReadableChars`, `autoScrollEnabled`).
2. Run initial scan/injection.
3. Setup debounced mutation observer.
4. Create HUD hidden.
5. Subscribe to background updates.

### On play click
- Build ordered queue from clicked paragraph onward.
- Send `CONTENT_START_SESSION`.
- Optimistically set clicked button loading state.

### On session update
- Update HUD state/progress/buttons.
- Update active highlight.
- If `currentTtsId` changed and status playing -> call auto-scroll helper.

### v1.3 Notes
- Respect `reason = superseded_by_new_tab` by clearing local active UI cleanly.

---

## 6.2 `src/content/paragraph_detector.js`

### Responsibilities
- Discover and filter readable nodes.
- Avoid nested duplicates and non-content regions.

### API
- `collectCandidates(root?)`
- `isReadableNode(el, settings)`
- `extractReadableText(el)`
- `dedupeNested(nodes)`
- `sortDomOrder(nodes)`

### Filtering rules
- Non-empty, visible, minimum chars.
- Exclude semantic noise containers.
- Prefer leaf-most readable blocks.

---

## 6.3 `src/content/button_injector.js`

### Responsibilities
- Inject per-paragraph play button.
- Maintain button states by `ttsId`.

### API
- `injectPlayButton(el, ttsId, handlers)`
- `setButtonState(ttsId, state)`
- `cleanupRemovedNodes()` (optional)

### v1.3 CSP rule
- Icons are inline SVG constants embedded directly.
- No remote asset fetch required.
- Shadow DOM for style isolation and host CSS immunity.

---

## 6.4 `src/content/hud.js`

### Responsibilities
- Render fixed bottom-center HUD.
- Bind transport controls.

### API
- `createHud({onAction})`
- `renderState(sessionUpdate)`
- `setProgress(currentTime, duration)`
- `show/hide`
- `destroy` (optional)

### Controls
- prev, rewind 15s, play/pause, forward 15s, next, close/stop

### v1.3 Notes
- HUD should update independently from request dispatch timing.
- Avoid blocking first network call during initial show animation.

---

## 6.5 `src/content/auto_scroll.js` (optional extraction)

### Responsibilities
- Encapsulate scroll behavior and suppression heuristics.

### API
- `maybeScrollIntoView(element, {enabled, tabVisible, userScrollingRecently, selectingText})`

### Default behavior
- `element.scrollIntoView({ behavior: "smooth", block: "center" })`

### Suppression heuristics
- Skip if tab hidden/inactive.
- Skip if text selection in progress.
- Skip briefly after user manual wheel/scroll (e.g., 800ms).

---

## 7) Offscreen Layer

## 7.1 `src/offscreen/offscreen.html`
- Minimal shell loading `offscreen.js`.

## 7.2 `src/offscreen/offscreen.js`

### Responsibilities
- Maintain one audio element.
- Execute transport commands.
- Emit playback events.

### Commands
- `OFFSCREEN_PLAY`
- `OFFSCREEN_PAUSE`
- `OFFSCREEN_RESUME`
- `OFFSCREEN_SEEK_REL`
- `OFFSCREEN_STOP`

### Events emitted
- `OFFSCREEN_AUDIO_TIME` (throttled, e.g., 4Hz)
- `OFFSCREEN_AUDIO_ENDED`
- `OFFSCREEN_AUDIO_STATE`
- `OFFSCREEN_SEEK_UNDERFLOW`
- `OFFSCREEN_SEEK_OVERFLOW`
- `OFFSCREEN_AUDIO_ERROR`

### Boundary semantics
- Under/overflow event emission only.
- Must not mutate queue index (background-only concern).

---

## 8) Options Layer

## 8.1 `src/options/options.html`
Fields:
- API key
- model
- voice
- monthly budget
- threshold values
- hard stop toggle
- min readable chars
- auto-scroll toggle
- (optional advanced) prefetch gate values:
  - min delay ms
  - progress threshold
  - min listen ms

## 8.2 `src/options/options.js`
### Responsibilities
- Load defaults and persisted settings.
- Validate and save settings.
- Render usage summary.
- Reset usage action.

### Validation rules
- Budget > 0.
- Thresholds in ascending order, each in `[0,1]`.
- `prefetchMinDelayMs >= 0`
- `prefetchProgressThreshold` in `[0,1]`
- `prefetchMinListenMs >= 0`
- `singleSessionGlobal` locked true in v1.x UI.

## 8.3 `src/options/options.css`
- Accessible form layout.
- Clear warning/error/success messaging.

---

## 9) Critical Runtime Sequences

## 9.1 Paragraph Click -> First Audio (Latency-first)
1. Content sends start-session payload.
2. Background enforces single-session global stop of prior session.
3. Background validates budget/settings.
4. Background dispatches TTS request immediately.
5. Background sends `loading` update to content.
6. On response, background commands offscreen play.
7. Background emits `playing` update.
8. Prefetch gate state initialized, not triggered immediately unless gate passes.

## 9.2 Prefetch Gate Operation
- Gate evaluated on `AUDIO_TIME` ticks and timer checks.
- Trigger once per track.
- Cancel/reset gate on track/session change.

## 9.3 New Tab Starts During Pause
- Existing paused session is terminated (not preserved concurrently).
- Prior tab receives `stopped` with reason `superseded_by_new_tab`.

---

## 10) Error and Reason Handling

### Session reasons
- `superseded_by_new_tab`
- `user_stopped`
- `queue_ended`
- `budget_blocked`
- `error`

### Error UX expectations
- Recoverable messages in HUD.
- Retry action where applicable.
- Clear guidance for API key/quota issues.

---

## 11) Testing Matrix (v1.3)

### Functional
1. Start from arbitrary paragraph; reads sequentially.
2. New tab session supersedes old tab session every time.
3. Pause in Tab A, start in Tab B => Tab A stops with proper reason.
4. Rewind underflow -> previous paragraph transition.
5. Forward overflow -> next paragraph transition.

### Prefetch/Cost
6. Rapid paragraph hopping does not trigger uncontrolled prefetch bursts.
7. Prefetch triggers only after 2s/50%/5s gate.
8. In-flight duplicate cache-key requests are deduped.
9. Stale prefetch result is ignored after session/version change.

### UI/UX
10. HUD loading appears without delaying request dispatch.
11. Auto-scroll centers active paragraph when enabled.
12. Auto-scroll suppression works during recent manual scrolling.
13. Inline SVG controls render on CSP-restricted pages.

### Budget
14. 80/95/100% threshold behaviors match settings.
15. Hard-stop blocks new requests at limit when enabled.

---

## 12) Definition of Done (Engineering)

- v1.3 behaviors implemented and documented in code comments/JSDoc.
- No direct OpenRouter calls outside `openrouter_client.js`.
- No concurrent multi-tab audio sessions.
- Deferred prefetch gate and cancellation logic verified.
- Auto-scroll + suppression heuristics verified.
- Budget limits and session reasons visible in user-facing state updates.
- No duplicate fetches for identical in-flight cache keys.