---
name: Chat widget minimized/fullscreen pattern
description: How ChatWidget.tsx structures its minimize-to-bar and fullscreen states, and an a11y trap to avoid there.
---

`client/src/components/ChatWidget.tsx` renders three mutually exclusive states off `isOpen`/`isMinimized`/`isFullscreen`: closed launcher pill, minimized floating bar, and the full Card (normal or fullscreen-sized).

**Rule:** never nest an interactive close/action control inside the bar's own `<button>` (e.g. `<span role="button">` inside `<button onClick=restore>`) — invalid DOM nesting causes browser auto-closing of the outer button and breaks click/keyboard handling.

**Why:** a code-review pass caught exactly this in the minimized bar (restore-on-click + close-icon combined into one `<button>`).

**How to apply:** structure it as a non-interactive wrapping `<div>` containing sibling `<button>`s (one for restore, one for close) instead. Also keep the fullscreen toggle button visible on all breakpoints (no `hidden sm:*`) so mobile users can enter/exit fullscreen too.
