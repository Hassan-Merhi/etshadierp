# Remote support Phase 7 — cursor, scroll, and viewport accuracy

## Scope

This phase keeps remote mouse control aligned with the exact visible ERP browser viewport. It does not expand control beyond the authenticated ERP tab and does not weaken any existing permission, password, sensitive-action, or audit protection.

## Coordinate mapping

- Controller coordinates remain normalized from `0` to `1`.
- The target uses one shared mapping function for pointer display, hit testing, clicking, and scroll targeting.
- When `window.visualViewport` is available, its width, height, offsets, and scale define the visible target area.
- Browsers without `visualViewport` continue to use `window.innerWidth` and `window.innerHeight`.
- Coordinates are bounded to the final visible pixel so edge clicks cannot escape the target viewport.
- Invalid or non-finite coordinates continue to fail closed.

## Scroll targeting

- Scrolling starts at the element under the mapped pointer.
- A nested scroll container is selected only when it can still move in the requested direction.
- When an inner panel is already at its edge, scrolling bubbles to a scrollable parent.
- When no local container can move, the page viewport receives the scroll.
- Zero-delta and non-finite scroll commands remain ignored or bounded by the existing server policy.

## Preserved protections

This phase does not change:

- controller ownership and exact-tab binding;
- password-confirmation requirements;
- runtime and rollout flags;
- command rate limits;
- sensitive-route blocking;
- protected-element and action allowlists;
- keyboard-field safety;
- command auditing.

## Verification

Focused jsdom coverage verifies:

- normal image-point normalization;
- visual viewport offset, size, scale, and edge clamping;
- identical coordinates for cursor display and hit testing;
- local scrolling before page scrolling;
- scroll bubbling when an inner panel is exhausted;
- invalid-coordinate and empty-scroll fail-closed behavior.
