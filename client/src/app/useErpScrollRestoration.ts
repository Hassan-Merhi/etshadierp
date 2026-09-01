import { useEffect } from "react";
import { consumeErpScrollRestore } from "@/lib/erp-navigation-history";

/**
 * Restores the ERP workspace scroll position after browser Back/Forward while
 * preserving the existing behavior of focusing and resetting main content on
 * ordinary route changes.
 */
export function useErpScrollRestoration(currentLocation: string): void {
  useEffect(() => {
    const main = document.getElementById("main-content");
    if (!main) return;

    const restoreScrollTop = consumeErpScrollRestore();
    const targetScrollTop = restoreScrollTop ?? 0;
    main.scrollTop = targetScrollTop;
    main.focus({ preventScroll: true });

    if (restoreScrollTop === null) return;

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      main.scrollTop = targetScrollTop;
      secondFrame = window.requestAnimationFrame(() => {
        main.scrollTop = targetScrollTop;
      });
    });
    const settleTimer = window.setTimeout(() => {
      main.scrollTop = targetScrollTop;
    }, 150);

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(settleTimer);
    };
  }, [currentLocation]);
}
