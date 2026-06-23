import { useEffect } from "react";

/**
 * Global fix for Radix UI dialogs leaving body in a frozen state.
 *
 * Root causes:
 * 1. Radix applies `overflow: hidden` + `pointer-events: none` to <body>
 *    via @radix-ui/react-remove-scroll when ANY dialog/sheet opens.
 * 2. If a dialog is unmounted while its close-animation is still running,
 *    or if multiple sibling dialogs open/close in rapid succession,
 *    Radix's internal scroll-lock counter can drop to 0 without cleaning
 *    up the body styles — leaving the page frozen.
 *
 * This hook uses a MutationObserver to watch for ALL Radix overlay elements
 * transitioning to data-state="closed". Once none are open, it force-clears
 * any stuck body / html overflow styles.
 */
export function useDialogScrollFix() {
  useEffect(() => {
    const DELAY_MS = 350; // longer than the 200ms close animation in dialog.tsx

    let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleCleanup() {
      if (cleanupTimer) clearTimeout(cleanupTimer);
      cleanupTimer = setTimeout(() => {
        const openOverlays = document.querySelectorAll(
          '[role="dialog"][data-state="open"], [data-radix-dialog-overlay][data-state="open"]'
        );
        if (openOverlays.length === 0) {
          // No Radix dialogs/sheets open — safe to restore body
          document.body.style.removeProperty("overflow");
          document.body.style.removeProperty("pointer-events");
          document.documentElement.style.removeProperty("overflow");
          document.documentElement.style.removeProperty("pointer-events");

          // Remove any stale aria-hidden that Radix left on non-dialog elements
          document.querySelectorAll("body > *:not([role='dialog']):not([data-radix-portal])").forEach((el) => {
            if (el.getAttribute("aria-hidden") === "true" && !el.closest('[role="dialog"]')) {
              el.removeAttribute("aria-hidden");
            }
          });
        }
      }, DELAY_MS);
    }

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (
          m.type === "attributes" &&
          (m.attributeName === "data-state" || m.attributeName === "aria-hidden" || m.attributeName === "style")
        ) {
          const el = m.target as HTMLElement;
          const state = el.getAttribute("data-state");
          if (state === "closed" || m.attributeName === "aria-hidden") {
            scheduleCleanup();
          }
        }
      }
    });

    observer.observe(document.body, {
      attributes: true,
      subtree: true,
      attributeFilter: ["data-state", "aria-hidden", "style"],
    });

    return () => {
      observer.disconnect();
      if (cleanupTimer) clearTimeout(cleanupTimer);
    };
  }, []);
}
