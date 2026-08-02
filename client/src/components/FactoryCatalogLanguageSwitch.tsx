import { useEffect } from "react";
import { GlobalLanguageSwitch } from "@/components/GlobalLanguageSwitch";
import { useApplicationLanguage } from "@/contexts/ApplicationLanguageContext";
import { queryClient } from "@/lib/queryClient";

/**
 * Compatibility mount for Factory layouts. The application now has one global
 * language source; this component no longer owns a separate Factory preference.
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

  return (
    <div className="mb-3" data-testid="factory-catalog-language-switch">
      <GlobalLanguageSwitch embedded />
    </div>
  );
}
