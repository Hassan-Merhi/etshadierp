import { useEffect } from "react";
import { useApplicationLanguage } from "@/contexts/ApplicationLanguageContext";
import { queryClient } from "@/lib/queryClient";

/**
 * Compatibility mount retained for existing Factory layouts. The visible
 * selector is now the single application-wide switch rendered by App.tsx.
 */
export function FactoryCatalogLanguageSwitch() {
  const { language } = useApplicationLanguage();

  useEffect(() => {
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
