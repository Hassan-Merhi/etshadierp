import { entries1 } from "./entries1";
import { entries2 } from "./entries2";
import type { ModuleCatalog } from "../../moduleCatalog";
import { useModuleTranslation } from "../../useModuleTranslation";

/**
 * erp interface text.
 *
 * English is the source text lifted from the JSX. French and Arabic are
 * filled in by a reviewed translation pass; entries without them render
 * English via the module fallback.
 */
export const erpCatalog: ModuleCatalog = {
  ...entries1,
  ...entries2,
};

/** Bound lookup so a page needs one import rather than two. */
export function useErpText() {
  return useModuleTranslation(erpCatalog);
}
