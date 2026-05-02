# Seek State Transitions

The offscreen document is responsible only for intra-track seek detection. When a seek target exits track bounds, it emits an event and lets the background queue manager decide paragraph navigation.

| Current queue index | Offscreen seek outcome | Background action | Result |
| --- | --- | --- | --- |
| `i > 0` | `SEEK_UNDERFLOW` (`target < 0`) | Move to `i - 1`; start at `max(previousDuration - 15, 0)` | Jumps to previous paragraph near the end |
| `i = 0` | `SEEK_UNDERFLOW` (`target < 0`) | Stay on `i`; clamp seek to `0` | Continues current paragraph from start |
| `0 <= target <= duration` | in-range seek | No queue transition | Continues within the current paragraph |
| `i < last` | `SEEK_OVERFLOW` (`target > duration`) | Move to `i + 1`; start at `0` | Jumps to next paragraph |
| `i = last` | `SEEK_OVERFLOW` (`target > duration`) | No queue transition | Remains on current paragraph |
