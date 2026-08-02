import { useCallback } from "react";
import { useApplicationLanguage } from "@/contexts/ApplicationLanguageContext";
import { resolveModuleText, type ModuleCatalog } from "./moduleCatalog";

/**
 * Subscribes a component to the active language and returns a lookup bound to
 * one module catalog.
 *
 * Components call this instead of reading a module-level function so that a
 * language change re-renders them through React rather than relying on the
 * transitional DOM translation bridge.
 */
export function useModuleTranslation(catalog: ModuleCatalog) {
  const { language } = useApplicationLanguage();
  return useCallback((key: string) => resolveModuleText(catalog, key, language), [catalog, language]);
}
