import { entries1 } from "./entries1";
import { entries2 } from "./entries2";
import { entries3 } from "./entries3";
import { entries4 } from "./entries4";
import type { ModuleCatalog } from "../../moduleCatalog";
import { useModuleTranslation } from "../../useModuleTranslation";

/**
 * factory interface text.
 *
 * English is the source text lifted from the JSX. French and Arabic are
 * filled in by a reviewed translation pass; entries without them render
 * English via the module fallback.
 */
export const factoryCatalog: ModuleCatalog = {
  ...entries1,
  ...entries2,
  ...entries3,
  ...entries4,
};

/** Bound lookup so a page needs one import rather than two. */
export function useFactoryText() {
  return useModuleTranslation(factoryCatalog);
}
