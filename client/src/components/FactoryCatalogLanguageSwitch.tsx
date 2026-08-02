import { useEffect } from "react";
import { useApplicationLanguage } from "@/contexts/ApplicationLanguageContext";
import { persistFactoryCatalogLanguagePreference } from "@/lib/factoryCatalogPreference";
import { queryClient } from "@/lib/queryClient";

/**
 * Compatibility mount retained for existing Factory layouts. The visible
 * selector is now the single application-wide switch rendered by App.tsx.
 * Until Factory French catalog fields arrive in Phase 5, French intentionally
 * uses the canonical English Factory catalog response rather than inventing or
 * overwriting stored product text.
 */
export function FactoryCatalogLanguageSwitch() {
  const { language } = useApplicationLanguage();

  useEffect(() => {
    const factoryLanguage = language === "ar" ? "ar" : "en";
    persistFactoryCatalogLanguagePreference(factoryLanguage, window.localStorage, document);
    void queryClient.invalidateQueries({
      predicate: (query) => {
        const first = query.queryKey[0];
        return typeof first === "string" && first.startsWith("/api/factory");
      },
      refetchType: "active",
    });
  }, [language]);

  return null;
}
