# AGENTS.md

## Scope
Applies to `src/background/` and all subdirectories.

## Background Layer Mission
This layer is the system orchestrator and state authority for reading sessions.

## Non-Negotiable Rules
- Enforce exactly one active session globally across tabs.
- All provider communication must go through `openrouter_client.js`.
- Queue transitions and session lifecycle decisions live here (not in offscreen/content).
- Emit canonical message/event names from shared constants only.
- Emit canonical stop reasons and error codes; do not invent ad-hoc strings.

## Required Behaviors
- On new session in another tab, terminate old one and emit reason `superseded_by_new_tab`.
- Startup must be latency-first:
  1) validate settings/budget
  2) dispatch TTS request immediately
  3) render/update loading state in parallel
- Auto-advance on track end with clean queue-end handling.
- Seek boundary events (`UNDERFLOW`/`OVERFLOW`) must trigger queue index logic here.

## State & Data Contracts
- Keep session state normalized and serializable where possible.
- Cache keys must include session + paragraph id + model + voice dimensions.
- Deduplicate in-flight requests to avoid duplicate provider calls.
- Usage increments should be based on normalized adapter output (`charCount`, estimated cost).

## Error Handling
- Map provider/network errors to canonical internal error codes.
- Preserve enough debug metadata for diagnostics without exposing secrets/PII.
- Fail loudly and predictably; avoid silent fallbacks.

## Code Change Guidance
- Prefer small helpers over monolithic handlers.
- Keep message routing readable (switch/handler map).
- Avoid introducing implicit global mutable state beyond documented maps/refs.
- Add JSDoc for non-obvious payload shapes.

## Validation Checklist
For changes in this scope, verify:
- Single-session supersede behavior across tabs.
- Correct reason propagation on stop states.
- Correct handling for pause/resume/seek/prev/next/stop HUD actions.
- Prefetch gate timing/progress/listen thresholds.
- Budget warning and hard-block behavior.
- No direct provider calls outside adapter module.