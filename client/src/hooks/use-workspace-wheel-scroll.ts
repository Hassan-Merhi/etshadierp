import { useEffect } from "react";

/**
 * Forwards mouse-wheel events to #main-content immediately — without
 * requiring a prior click or scrollbar hover.
 *
 * Attaches a non-passive `wheel` listener to the provided shell container.
 * On each event it walks up from the pointer target's DOM ancestor chain:
 *
 *   • If it finds a vertically-scrollable element that is NOT #main-content
 *     (e.g. a dialog, sheet, sidebar SidebarContent, table overflow wrapper,
 *     command palette list, textarea, select listbox) it returns early so
 *     that nested element continues to scroll normally via the browser.
 *
 *   • Otherwise it forwards the vertical delta to #main-content via
 *     scrollBy() and calls preventDefault() to prevent double-scrolling.
 *
 * Guards:
 *   - Ctrl+wheel  → ignored (browser zoom)
 *   - deltaY === 0 → ignored (pure horizontal touchpad swipe)
 *   - #main-content already at the top/bottom boundary → not forwarded,
 *     so the user doesn't feel scroll-trapped
 *   - #main-content not found / not scrollable (e.g. POS full-screen canvas)
 *     → no-op
 */

function isVerticallyScrollable(el: Element): boolean {
  // Never treat the document root or body as a "nested" scrollable
  if (el === document.documentElement || el === document.body) return false;
  const { overflowY } = getComputedStyle(el);
  return (
    (overflowY === "auto" || overflowY === "scroll") &&
    el.scrollHeight > el.clientHeight
  );
}

export function useWorkspaceWheelScroll(
  containerRef: React.RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleWheel(e: WheelEvent): void {
      // 1. Ctrl+wheel = browser zoom; pure horizontal delta = touchpad swipe
      if (e.ctrlKey || e.deltaY === 0) return;

      const main = document.getElementById("main-content") as HTMLElement | null;
      if (!main) return;

      // 2. Walk up from the event target. If we encounter a vertically
      //    scrollable element that is NOT #main-content before reaching the
      //    shell container, that area owns this scroll event — leave it alone.
      let node = e.target as Element | null;
      while (node && node !== container) {
        if (node !== main && isVerticallyScrollable(node)) return;
        node = node.parentElement;
      }

      // 3. Don't trap scroll when #main-content is already at the boundary
      //    being scrolled toward (avoids a stuck/frozen feel).
      const atTop = e.deltaY < 0 && main.scrollTop === 0;
      const atBottom =
        e.deltaY > 0 &&
        main.scrollHeight - main.scrollTop - main.clientHeight < 1;
      if (atTop || atBottom) return;

      // 4. Forward the vertical delta to #main-content.
      e.preventDefault();
      main.scrollBy({ top: e.deltaY, behavior: "auto" });
    }

    // passive: false is required to allow calling preventDefault()
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
