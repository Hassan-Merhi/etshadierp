# Screen Watch Phase 5 — Final Viewer Release Gate

Phase 5 closes the passive screen-watch repair program after the capture, recovery, fallback and viewer changes from Phases 1–4.

## Completed viewer requirements

- Captured frames retain their original aspect ratio in Fit mode.
- 100% mode renders the captured pixel dimensions and uses scrolling instead of stretching.
- Connection quality is based on frame freshness as well as transport connectivity.
- A connected stream with an old frame is still classified as stale.
- Waiting, live, delayed, recovering and fallback states remain distinct.
- The viewer keeps the last valid frame visible while transport recovery runs.
- Fallback frames expose the capture failure reason and are not presented as successful DOM captures.
- Cursor and click overlays use normalized coordinates against the displayed frame.
- Repeated page-history routes are grouped.
- Capture resolution, viewport, scroll position, zoom, DPR, encoded size, render duration and source remain visible.

## Regression boundaries

Focused tests cover:

- landscape and portrait aspect-ratio containment;
- the employee viewport ratio shown in the original failure report;
- invalid source and container dimensions;
- exact Excellent, Good, Delayed, Stale and Waiting thresholds;
- stale-frame classification while SSE remains connected;
- millisecond, fractional-second, whole-second and invalid delay formatting.

## Merge order

1. PR #494 — Screen Watch Phases 1–2
2. PR #496 — Screen Watch Phases 3–4
3. Phase 5 PR — final viewer regression and release gate

## Database impact

No SQL, schema migration or production data repair is required.

## Production acceptance

After deployment, open Watch for an active POS user and confirm:

1. Source normally reports `dom` or `retry`, not `fallback`.
2. The displayed screen has the same aspect ratio as the employee viewport.
3. Frame age stays below five seconds while the page is changing.
4. Disconnecting and restoring the network enters recovery and resumes without closing the viewer.
5. A forced capture failure displays the failure reason without stretching the fallback frame.
