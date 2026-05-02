# AGENTS.md

## Scope
Applies to `src/content/` and all subdirectories.

## Content Layer Mission
Detect readable content, inject controls, and render responsive HUD UX while deferring authority to background state.

## Non-Negotiable Rules
- Inject exactly one control per readable node.
- Use stable per-page-session `data-tts-id` values.
- Use Shadow DOM style isolation for injected controls.
- Keep inline SVG icons available (no dependence on remote assets).
- Do not own session truth; background is the authority.

## Readability & Injection Rules
- Candidate discovery starts from: `p, li, article section`.
- Apply filters:
  - non-empty trimmed text
  - minimum char threshold from settings
  - visibility/layout checks
  - excluded semantic zones (`nav`, `footer`, `aside`, `form`, `button`, `[aria-hidden="true"]`)
  - nested dedupe preferring leaf-most nodes
- MutationObserver logic must be debounced and idempotent.

## HUD & Interaction Rules
- HUD hidden while idle; shown on first playback action.
- Required controls: prev, rewind 15s, play/pause, forward 15s, next, close/stop.
- Required states: Loading, Playing, Paused, Error, Blocked.
- Close/Stop must clear highlight and hide HUD.
- Queue/session actions are requested via messages, not decided locally.

## Messaging Rules
- Use shared message constants only.
- Send ordered queue payload from clicked paragraph onward.
- Consume background session updates to render UI state.
- Do not hardcode enum strings in multiple places.

## UX & Performance
- UI updates should be snappy and avoid layout thrash.
- Avoid duplicate listeners on reinjection/re-render.
- Keep highlight/auto-scroll behavior stable and reversible.
- Guard against stale DOM references when content mutates.

## Accessibility & Resilience
- Controls should have accessible labels/tooltips where applicable.
- Keep interaction behavior keyboard-friendly when possible.
- Handle missing/removed target nodes gracefully.

## Validation Checklist
For changes in this scope, verify:
- No duplicate buttons after dynamic content changes.
- Clicking a button creates correct queue payload ordering.
- HUD controls dispatch expected actions.
- Session updates from background correctly drive HUD and highlight state.
- Auto-scroll toggle is respected.