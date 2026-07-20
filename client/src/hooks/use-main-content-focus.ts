import { useEffect } from "react";

/**
 * Moves keyboard/scroll focus to the primary scroll container (#main-content)
 * whenever the route changes, so mouse wheel and arrow-key scrolling work
 * immediately without requiring a prior click.
 *
 * Guards:
 * - skip=true  → caller opts out (e.g. POS full-height routes where <main> has
 *                overflow-hidden and cannot scroll).
 * - open dialog / popover → do not steal focus from modal UI.
 * - active form field (input/textarea/select/contenteditable) → do not
 *   interrupt the user mid-typing.
 */
export function useMainContentFocus(location: string, skip = false) {
  useEffect(() => {
    if (skip) return;

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

    // Never steal focus from an open Radix dialog / sheet / popover.
    const hasOpenOverlay =
      !!document.querySelector(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-radix-popper-content-wrapper]'
      );
    if (hasOpenOverlay) return;

    const main = document.getElementById("main-content");
    main?.focus({ preventScroll: true });
  }, [location, skip]); // eslint-disable-line react-hooks/exhaustive-deps
}
