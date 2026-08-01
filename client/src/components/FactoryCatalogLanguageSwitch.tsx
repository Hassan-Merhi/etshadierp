import { useEffect, useState } from "react";
import { Languages } from "lucide-react";
import type { FactoryCatalogLanguage } from "@shared/factoryBilingualContract";
import { Button } from "@/components/ui/button";
import {
  persistFactoryCatalogLanguagePreference,
  readFactoryCatalogLanguagePreference,
} from "@/lib/factoryCatalogPreference";
import { queryClient } from "@/lib/queryClient";

export const FACTORY_CATALOG_LANGUAGE_EVENT = "factory-catalog-language-change";

export function FactoryCatalogLanguageSwitch() {
  const [language, setLanguage] = useState<FactoryCatalogLanguage>(() =>
    readFactoryCatalogLanguagePreference(typeof window === "undefined" ? null : window.localStorage)
  );

  useEffect(() => {
    persistFactoryCatalogLanguagePreference(
      language,
      typeof window === "undefined" ? null : window.localStorage,
      typeof document === "undefined" ? null : document
    );
  }, [language]);

  const choose = (next: FactoryCatalogLanguage) => {
    if (next === language) return;
    persistFactoryCatalogLanguagePreference(next, window.localStorage, document);
    setLanguage(next);
    window.dispatchEvent(new CustomEvent<FactoryCatalogLanguage>(FACTORY_CATALOG_LANGUAGE_EVENT, { detail: next }));
    void queryClient.invalidateQueries({
      predicate: (query) => {
        const first = query.queryKey[0];
        return typeof first === "string" && first.startsWith("/api/factory");
      },
      refetchType: "active",
    });
  };

  return (
    <div
      className="mb-3 flex items-center justify-end gap-1"
      dir="ltr"
      data-testid="factory-catalog-language-switch"
    >
      <span className="mr-1 hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
        <Languages className="h-3.5 w-3.5" />
        Product language
      </span>
      <Button
        type="button"
        size="sm"
        variant={language === "en" ? "default" : "outline"}
        onClick={() => choose("en")}
        aria-pressed={language === "en"}
        data-testid="factory-language-en"
      >
        English
      </Button>
      <Button
        type="button"
        size="sm"
        variant={language === "ar" ? "default" : "outline"}
        onClick={() => choose("ar")}
        aria-pressed={language === "ar"}
        data-testid="factory-language-ar"
      >
        العربية
      </Button>
    </div>
  );
}
