import { entries1 } from "./entries1";
import type { ModuleCatalog } from "../../moduleCatalog";
import { useModuleTranslation } from "../../useModuleTranslation";

/**
 * pos interface text.
 *
 * English is the source text lifted from the JSX. French and Arabic are
 * filled in by a reviewed translation pass; entries without them render
 * English via the module fallback.
 */
export const posCatalog: ModuleCatalog = {
  ...entries1,
};

/** Bound lookup so a page needs one import rather than two. */
export function usePosText() {
  return useModuleTranslation(posCatalog);
}
