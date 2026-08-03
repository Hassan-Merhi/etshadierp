# Remote support Phase 3 — viewing quality and accuracy

## Scope

Phase 3 improves the existing read-only screen viewer without enabling remote mouse or keyboard control.

## Delivered

- Higher-fidelity viewport captures with bounded resolution and adaptive compression.
- Safe preservation of same-origin, data, and blob images, SVG images, and CSS backgrounds.
- Explicit viewport, capture, and server-receipt metadata on every frame.
- Cursor observation and click markers normalized to the captured viewport.
- Contain-layout calculations so overlays align with letterboxed screen images.
- Viewer connection mode, frame age, delivery delay, capture dimensions, viewport dimensions, zoom, and scroll position.
- Fit and 100% viewing modes, pan/scroll for actual-size inspection, and fullscreen on the complete viewer surface.

## Safety and compatibility

- The screen feed remains read-only.
- Remote mouse and keyboard control remain disabled.
- Existing polling and Server-Sent Events fallback behavior remains intact.
- The Phase 1 emergency stop and `DISABLE_SCREEN_FEED=true` hard override remain unchanged.
- Unsafe cross-origin image assets are excluded from capture rather than tainting the canvas.
- Frame payload and metadata are bounded and sanitized server-side.
- No SQL or database migration is required.
