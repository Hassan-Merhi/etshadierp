import { useLocation } from "wouter";
import { useEscapeBack } from "./use-escape-back";
import { getParentRoute } from "@/lib/parent-routes";

/**
 * Esc-back wrapper that navigates to a known parent route via wouter
 * (instead of `window.history.back()`), so behavior is correct even
 * after a refresh, deep link, or redirect chain.
 *
 * - If `parent` is provided, Esc navigates there.
 * - If `parent` is omitted, the parent is looked up from the current
 *   pathname via `getParentRoute()`.
 * - If no parent can be resolved, Esc is a no-op on this page.
 *
 * For pages with an inline "selected item" view, keep using
 * `useEscapeBack` directly with a two-step handler (clear selection
 * first, then navigate up on the next Esc).
 */
export function useEscapeToParent(parent?: string | null) {
  const [location, navigate] = useLocation();
  const target = parent ?? getParentRoute(location);
  useEscapeBack(target ? () => navigate(target) : null);
}
