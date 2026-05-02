# OpenTTS Browser Extension — Canonical Specification (v1.3)

**Version:** 1.3  
**Target Platform:** Google Chrome (Manifest V3)  
**Primary Engine:** OpenRouter TTS (default model: `openai/gpt-4o-mini-tts`)  
**Objective:** Deliver a Speechify-style browser reading experience with low latency, robust playback, and tight cost controls.

---

## 1) Product Goals

- Inject play controls on readable page paragraphs.
- Provide a persistent floating HUD with transport controls.
- Support seamless sequential reading with auto-advance.
- Minimize perceived latency using smart prefetch.
- Enforce budget limits and reduce wasted API calls.
- Keep behavior privacy-first and predictable across tabs.

---

## 2) System Architecture

### 2.1 Content Script
- Detect readable nodes.
- Inject inline play controls with `data-tts-id`.
- Render/manage floating HUD.
- Highlight active paragraph.
- Auto-scroll active paragraph into view (configurable).
- Send user actions to background and consume session updates.

### 2.2 Background Service Worker (Source of Truth)
- Owns all reading session state.
- Enforces **single active session globally** across tabs.
- Owns OpenRouter calls through a single adapter module.
- Owns queue logic, budget logic, prefetch logic, and cache.
- Coordinates content script and offscreen document.

### 2.3 Offscreen Document
- Hosts one `HTMLAudioElement`.
- Executes play/pause/resume/seek/stop.
- Emits playback lifecycle events and time updates.

### 2.4 Options Page
- API key, model, voice.
- Budget/threshold controls.
- Auto-scroll toggle.
- Usage display + reset controls.
- Privacy disclosure.

---

## 3) Manifest (MV3) Requirements

### 3.1 Permissions
- `storage`
- `activeTab`
- `scripting`
- `offscreen`
- `tabs`
- `contextMenus`
- `alarms` (recommended)

### 3.2 Host Permissions
- `https://openrouter.ai/*`

### 3.3 Core Entries
- Service worker: `src/background/service_worker.js`
- Content script: `src/content/content_script.js`
- Offscreen page: `src/offscreen/offscreen.html`
- Options page: `src/options/options.html`

---

## 4) Canonical API Integration Rules (OpenRouter)

### 4.1 Single Adapter Rule
All provider communication MUST go through `src/background/openrouter_client.js`.
No other module may construct raw OpenRouter requests.

### 4.2 Default Model
- Default: `openai/gpt-4o-mini-tts`
- User can override model in settings.
- Invalid/empty override falls back to default.

### 4.3 Normalized Adapter Output
Adapter returns:
- `audioDataUrl: string`
- `mimeType: string`
- `charCount: number`
- `modelUsed: string`
- `voiceUsed: string`

### 4.4 Error Mapping
Map provider/network issues to internal error codes:
- `AUTH_ERROR`
- `QUOTA_ERROR`
- `RATE_LIMIT`
- `BAD_REQUEST`
- `UPSTREAM_ERROR`
- `PARSE_ERROR`
- `NETWORK_ERROR`

---

## 5) Readable Paragraph Detection & Control Injection

### 5.1 Candidate Discovery
Start with selector:

    document.querySelectorAll('p, li, article section')

Then filter candidates by:
1. Trimmed text non-empty.
2. Minimum text length threshold (default 40 chars).
3. Visible in layout (`display`, `visibility`, geometry checks).
4. Excluded semantic zones not matched:
   - `nav`, `footer`, `aside`, `form`, `button`, `[aria-hidden="true"]`
5. Nested dedupe applied (prefer leaf-most readable nodes).

### 5.2 ID Assignment
Each readable node gets a stable per-page-session `data-tts-id`.

### 5.3 Injection Rules
- Inject exactly one play control per readable node.
- Use Shadow DOM style isolation.
- Use **inline SVG icons** embedded in script/template (no external icon URLs required).
- If extension asset icons are used, inline SVG fallback must still exist.

### 5.4 Dynamic Content
Use debounced `MutationObserver` to detect and process new readable content (infinite scroll support).

---

## 6) Floating HUD & UX Behavior

### 6.1 HUD Basics
- Fixed bottom-center.
- Hidden during Idle.
- Shown on first playback action.

### 6.2 Controls
- Previous paragraph
- Rewind 15s
- Play/Pause
- Fast-forward 15s
- Next paragraph
- Close/Stop

### 6.3 HUD Display
- State text: `Loading`, `Playing`, `Paused`, `Error`, `Blocked`
- Progress bar for current paragraph audio
- Optional paragraph snippet

### 6.4 Close Behavior
- Stop current session.
- Clear active paragraph highlight.
- Hide HUD.

---

## 7) Session, Queue, and Cross-Tab Policy

### 7.1 Session Ownership
Background service worker owns all queue/session transitions.

### 7.2 Queue Construction
On paragraph play click:
- Content script sends ordered `paragraphIds` and `textById` from clicked item onward.
- Background initializes session with current index at clicked paragraph.

### 7.3 Auto-Advance
On `audio ended`:
- Background advances to next queue item.
- Plays from cache if available; else fetches then plays.
- Stops cleanly at queue end.

### 7.4 Global Single-Session Rule (Mandatory)
Only one active session allowed across all tabs.

If user starts reading in Tab B while Tab A has a session (playing or paused):
1. Background stops Tab A offscreen playback.
2. Background marks Tab A session stopped with reason:
   - `superseded_by_new_tab`
3. Background starts Tab B session.

This prevents overlapping voices and state ambiguity.

---

## 8) Seek / Navigation Boundary Semantics

### 8.1 Responsibility Split
- Offscreen handles intra-track seek only.
- Background handles queue index transitions.

### 8.2 Boundary Events
If seek crosses track bounds:
- Rewind below 0 → offscreen emits `SEEK_UNDERFLOW`.
- Forward past duration → offscreen emits `SEEK_OVERFLOW`.

### 8.3 Background Handling
- On underflow:
  - If previous paragraph exists: move previous and start near end (`max(duration - 15, 0)`).
  - Else clamp to 0 on current track.
- On overflow:
  - If next exists: move next and start.
  - Else clamp to end or stop per policy.

---

## 9) Prefetch & Cache Policy (Latency + Cost Balanced)

### 9.1 Cache Key
Use session-scoped key:

    ${sessionId}:${ttsId}:${voice}:${model}

### 9.2 Prefetch Depth
- Default depth: 1 ahead
- Optional max depth: 2 (feature-gated)

### 9.3 Deferred Prefetch Trigger (Anti-Waste)
Do NOT prefetch immediately on paragraph start unless gate condition passes.

Prefetch may begin when ANY condition is met:
1. At least 50% of current audio consumed, OR
2. User has been on current paragraph for at least 5 seconds, OR
3. Minimum 2-second delay elapsed and playback still `playing`.

### 9.4 Cancellation / Invalidation
Cancel pending prefetch timers and/or ignore results when:
- User manually skips paragraph.
- Session pauses/stops.
- Session is replaced by another tab.
- Voice/model changes.
- Queue rebuilt.
- Tab closes/discards.

### 9.5 Duplicate-Request Prevention
If a request for the same cache key is in-flight, reuse that promise; never dispatch duplicate parallel requests for identical key.

---

## 10) Latency-First Start Logic

On paragraph click, request dispatch must be immediate after validation.

Required sequence:
1. Receive click/start intent.
2. Validate settings + budget.
3. Dispatch TTS request immediately.
4. In parallel, render HUD `Loading`.
5. On response, send audio to offscreen and transition to `Playing`.

HUD rendering/animation must never block network dispatch.

---

## 11) Budget, Usage, and Cost Guardrails

### 11.1 Usage Accounting
Track monthly usage in `chrome.storage.local` keyed by UTC month (`YYYY-MM`):
- `characters`
- `estimatedUsd`
- `updatedAt`

### 11.2 Default Settings
- `monthlyBudgetUsd = 4.50`
- `warnThresholds = [0.80, 0.95, 1.00]`
- `hardStopAtLimit = true`

### 11.3 Threshold Behavior
- >= 80%: warning
- >= 95%: strong warning
- >= 100%:
  - hard stop on: block new fetches
  - hard stop off: allow with persistent warning

### 11.4 Wasted-Credit Reduction
Deferred prefetch policy (Section 9.3) is mandatory to reduce unnecessary requests during paragraph hopping.

---

## 12) Auto-Scroll Behavior

### 12.1 Default
`autoScrollEnabled = true`

### 12.2 Trigger
When a **new paragraph** enters playing state, content script should call:

    element.scrollIntoView({ behavior: "smooth", block: "center" });

### 12.3 Safety Heuristics
Auto-scroll should be skipped if:
- Tab is not active/visible.
- User is actively selecting text.
- User manually scrolled very recently (optional heuristic, e.g., ~800ms suppression window).

---

## 13) Privacy & Data Handling

- Paragraph text/audio is not permanently stored remotely by extension.
- Remote processing is limited to OpenRouter request flow.
- Local storage contains only settings and usage/accounting metadata.
- No telemetry/analytics by default.
- Options page includes clear privacy statement.

---

## 14) Message Contract Requirements

Use shared constants for all message types and ensure payload consistency.

Minimum message families:
- Content → Background:
  - `CONTENT_START_SESSION`
  - `CONTENT_HUD_ACTION`
- Background → Content:
  - `BG_SESSION_UPDATE`
  - `BG_HUD_ERROR`
- Background → Offscreen:
  - `OFFSCREEN_PLAY`, `PAUSE`, `RESUME`, `SEEK_REL`, `STOP`
- Offscreen → Background:
  - `OFFSCREEN_AUDIO_TIME`, `AUDIO_ENDED`, `AUDIO_STATE`
  - `OFFSCREEN_SEEK_UNDERFLOW`, `OFFSCREEN_SEEK_OVERFLOW`
  - `OFFSCREEN_AUDIO_ERROR`

Payloads should include `sessionId` and `tabId` where relevant.
`BG_SESSION_UPDATE` should support `reason` values such as:
- `superseded_by_new_tab`
- `user_stopped`
- `queue_ended`
- `budget_blocked`

---

## 15) Lifecycle / Idle Safety

- Stop session when owning tab closes.
- Stop/pause and clear pending work when tab is discarded.
- Reject stale events by verifying active `sessionId` and tab ownership.
- Ensure no “zombie” playback continues after session replacement.

---

## 16) Settings Schema (Required Fields)

- `apiKey: string`
- `model: string` (default `openai/gpt-4o-mini-tts`)
- `voice: string`
- `monthlyBudgetUsd: number`
- `warnThresholds: [number, number, number]`
- `hardStopAtLimit: boolean`
- `minReadableChars: number` (default 40)
- `autoScrollEnabled: boolean` (default true)
- `prefetchMinDelayMs: number` (default 2000)
- `prefetchProgressThreshold: number` (default 0.5)
- `prefetchMinListenMs: number` (default 5000)
- `singleSessionGlobal: boolean` (default true, must remain true for v1.x)

---

## 17) UI State Matrix

| State | Behavior |
|---|---|
| Idle | Play controls visible; HUD hidden |
| Loading | Active control spinner; HUD visible with loading message |
| Playing | Progress updates; active paragraph highlighted; optional auto-scroll |
| Paused | Playback paused; buffered position retained |
| Error | User-friendly error + retry path |
| Blocked | Budget warning; new playback blocked if hard-stop enabled |

---

## 18) Milestones

1. **V1.0**
   - Context menu “Read selection”
   - OpenRouter adapter
   - Offscreen playback
   - Basic options page
2. **V1.1**
   - Readable paragraph detection
   - Inline controls + Shadow DOM
   - Dynamic content observer
3. **V1.2**
   - Queue manager + auto-advance
   - Seek boundary handling
   - Deferred prefetch + cache de-dup
4. **V2.0**
   - Full HUD polish
   - Auto-scroll
   - Cross-tab single-session behavior hardening
5. **V2.1**
   - Budget UX polish
   - Performance tuning
   - Edge-case reliability improvements

---

## 19) Acceptance Criteria

1. Play controls appear on readable nodes without duplicates.
2. Clicking any play control starts from that paragraph and advances sequentially.
3. TTS request dispatch starts immediately after validation (HUD does not block network start).
4. Only one session can be active globally; starting a new tab session stops prior tab session.
5. Rewind/forward boundary transitions behave deterministically across paragraphs.
6. Prefetch obeys deferred trigger gate (2s/50%/5s logic) and avoids burst waste during hopping.
7. Active paragraph highlight remains synchronized with audio state.
8. Auto-scroll centers newly active paragraph when enabled.
9. Budget thresholds and hard-stop behavior are enforced.
10. All provider calls route exclusively through canonical `openrouter_client`.
11. Inline SVG icons render reliably even under strict site CSP constraints.
12. No duplicate API calls for identical in-flight cache keys.