import { useLocation } from "wouter";
import { getParentRoute } from "@/lib/parent-routes";
import { useAppMode } from "@/contexts/AppModeContext";
import { goBackToPreviousErpLocation } from "@/lib/erp-navigation-history";

/**
 * Returns a callback for shared page Back controls.
 *
 * ERP mode is history-first: when the current page was reached from another
 * ERP page, browser history restores that exact URL (including tab/query
 * state). The parent-route registry is only the fallback for direct links,
 * refreshes, or pages without a tracked ERP origin.
 *
 * Factory/Properties keep their deterministic parent-route behavior.
 */
export function useBackToParent(parent?: string | null): () => void {
  const [location, navigate] = useLocation();
  const mode = useAppMode();

  return () => {
    if (mode === "erp" && goBackToPreviousErpLocation()) return;

    const target = parent ?? getParentRoute(location);
    if (target) {
      navigate(target);
    } else {
      window.history.back();
    }
  };
}
