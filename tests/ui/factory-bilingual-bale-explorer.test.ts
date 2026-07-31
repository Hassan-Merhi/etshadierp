import { beforeEach, describe, expect, it } from "vitest";
import {
  FACTORY_CATALOG_LANGUAGE_STORAGE_KEY,
  persistFactoryCatalogLanguagePreference,
  readFactoryCatalogLanguagePreference,
} from "@/lib/factoryCatalogPreference";

describe("Factory Bale Explorer language preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.cookie = "factory_catalog_language=; Path=/; Max-Age=0";
  });

  it("defaults safely to English and reads a persisted Arabic selection", () => {
    expect(readFactoryCatalogLanguagePreference(window.localStorage)).toBe("en");
    window.localStorage.setItem(FACTORY_CATALOG_LANGUAGE_STORAGE_KEY, "ar");
    expect(readFactoryCatalogLanguagePreference(window.localStorage)).toBe("ar");
    window.localStorage.setItem(FACTORY_CATALOG_LANGUAGE_STORAGE_KEY, "unsupported");
    expect(readFactoryCatalogLanguagePreference(window.localStorage)).toBe("en");
  });

  it("persists the selection in browser storage and the API cookie", () => {
    persistFactoryCatalogLanguagePreference("ar", window.localStorage, document);

    expect(window.localStorage.getItem(FACTORY_CATALOG_LANGUAGE_STORAGE_KEY)).toBe("ar");
    expect(document.cookie).toContain("factory_catalog_language=ar");
  });
});
