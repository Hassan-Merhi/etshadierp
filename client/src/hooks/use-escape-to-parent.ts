import { useLocation } from "wouter";
import { useEscapeBack } from "./use-escape-back";
import { getParentRoute } from "@/lib/parent-routes";
import { useAppMode } from "@/contexts/AppModeContext";
import { goBackToPreviousErpLocation } from "@/lib/erp-navigation-history";

/**
 * Esc-back wrapper.
 *
 * ERP mode prefers the exact previous browser entry so tabs/query state and
 * the originating list context survive. Direct links and refreshed detail
 * pages fall back to the deterministic parent-route registry.
 *
 * Factory/Properties retain deterministic parent routing.
 */
export function useEscapeToParent(parent?: string | null) {
  const [location, navigate] = useLocation();
  const mode = useAppMode();
  const target = parent ?? getParentRoute(location);

  useEscapeBack(() => {
    if (mode === "erp" && goBackToPreviousErpLocation()) return;
    if (target) navigate(target);
  });
}
