import { useEffect } from "react";
import { useApplicationLanguage } from "@/contexts/ApplicationLanguageContext";
import { persistFactoryCatalogLanguagePreference } from "@/lib/factoryCatalogPreference";
import { queryClient } from "@/lib/queryClient";

/**
 * Compatibility mount retained for existing Factory layouts. The visible
 * selector is the single application-wide switch rendered by App.tsx.
 * The selected application language is persisted without coercion so French
 * reaches the normal Factory catalog read path.
 */
export function FactoryCatalogLanguageSwitch() {
  const { language } = useApplicationLanguage();

  useEffect(() => {
    persistFactoryCatalogLanguagePreference(language, window.localStorage, document);
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
