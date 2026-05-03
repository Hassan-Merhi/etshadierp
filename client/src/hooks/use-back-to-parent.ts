import { useLocation } from "wouter";
import { getParentRoute } from "@/lib/parent-routes";

/**
 * Returns a callback that navigates to the current page's known parent
 * route via wouter (matching the Esc-to-parent behavior). If no parent
 * is registered for the current pathname, falls back to
 * `window.history.back()` so behavior is at least no worse than before.
 */
export function useBackToParent(parent?: string | null): () => void {
  const [location, navigate] = useLocation();
  return () => {
    const target = parent ?? getParentRoute(location);
    if (target) {
      navigate(target);
    } else {
      window.history.back();
    }
  };
}
