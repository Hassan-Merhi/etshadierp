import { useBackToParent } from "./use-back-to-parent";
import { useEscapeBack } from "./use-escape-back";

/**
 * Esc-back wrapper.
 *
 * Delegates to the exact same callback as shared page Back controls, so ERP
 * history, deterministic parent fallbacks, and Factory/Properties behavior
 * cannot drift between clicking Back and pressing Escape.
 */
export function useEscapeToParent(parent?: string | null) {
  const handleBack = useBackToParent(parent);
  useEscapeBack(handleBack);
}
