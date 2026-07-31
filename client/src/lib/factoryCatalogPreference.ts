import {
  parseFactoryCatalogLanguage,
  type FactoryCatalogLanguage,
} from "@shared/factoryBilingualContract";

export const FACTORY_CATALOG_LANGUAGE_STORAGE_KEY = "factory.catalog.language";
export const FACTORY_CATALOG_LANGUAGE_COOKIE = "factory_catalog_language";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface CookieDocumentLike {
  cookie: string;
}

export function readFactoryCatalogLanguagePreference(storage?: StorageLike | null): FactoryCatalogLanguage {
  if (!storage) return "en";
  try {
    return parseFactoryCatalogLanguage(storage.getItem(FACTORY_CATALOG_LANGUAGE_STORAGE_KEY), "en");
  } catch {
    return "en";
  }
}

export function persistFactoryCatalogLanguagePreference(
  language: FactoryCatalogLanguage,
  storage?: StorageLike | null,
  documentLike?: CookieDocumentLike | null
): void {
  try {
    storage?.setItem(FACTORY_CATALOG_LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Private browsing or hardened browser storage may be unavailable. The
    // cookie still keeps edit mutations consistent with the active language.
  }

  if (documentLike) {
    documentLike.cookie = `${FACTORY_CATALOG_LANGUAGE_COOKIE}=${language}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }
}
