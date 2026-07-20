import { useEffect } from "react";

/**
 * Moves keyboard/scroll focus to the primary scroll container (#main-content)
 * whenever the route changes, so mouse wheel and arrow-key scrolling work
 * immediately without requiring a prior click.
 *
 * Uses requestAnimationFrame so the focus call lands after the new route has
 * been committed to the DOM, not before.
 *
 * Guards:
 * - skip=true  → caller opts out (e.g. POS full-screen canvas routes where
 *                <main> has overflow-hidden and is not the scroll owner).
 * - Active form field (input/textarea/select/contenteditable) → do not
 *   interrupt typing.
 * - Actually open dialog / sheet / alert dialog / popover → do not steal
 *   focus from modal UI. The check uses [data-state="open"] so that Radix
 *   portal wrappers that are mounted but closed do NOT trigger the guard.
 */
export function useMainContentFocus(location: string, skip = false) {
  useEffect(() => {
    if (skip) return;

    const frame = requestAnimationFrame(() => {
      // Never steal focus from an active form field.
      const active = document.activeElement as HTMLElement | null;
      if (active) {
        const tag = active.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          active.isContentEditable
        ) {
          return;
        }
      }

      // Never steal focus from an actually-open Radix overlay.
      // Use [data-state="open"] so stale-but-closed popper wrappers
      // that remain mounted in the DOM do NOT trigger this guard.
      const hasOpenOverlay = !!document.querySelector(
        '[role="dialog"][data-state="open"],' +
        '[role="alertdialog"][data-state="open"],' +
        '[data-radix-popper-content-wrapper][data-state="open"],' +
        '[data-state="open"][role="listbox"],' +
        '[data-state="open"][role="menu"]'
      );
      if (hasOpenOverlay) return;

      const main = document.getElementById("main-content");
      if (!main) return;
      // Confirm the element is focusable (tabIndex -1 or >= 0) and visible.
      if (main.tabIndex < -1) return;
      if (main.hidden) return;

      main.focus({ preventScroll: true });
    });

    return () => cancelAnimationFrame(frame);
  }, [location, skip]); // eslint-disable-line react-hooks/exhaustive-deps
}
