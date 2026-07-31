import {
  parseFactoryCatalogLanguage,
  type FactoryCatalogLanguage,
} from "@shared/factoryBilingualContract";

export const FACTORY_CATALOG_LANGUAGE_STORAGE_KEY = "factory.catalog.language";
export const FACTORY_CATALOG_LANGUAGE_COOKIE = "factory_catalog_language";
export const FACTORY_CATALOG_SEARCH_COOKIE = "factory_catalog_search";

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
    // cookie still keeps the active page and API responses consistent.
  }

  if (documentLike) {
    documentLike.cookie = `${FACTORY_CATALOG_LANGUAGE_COOKIE}=${language}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }
}

export function persistFactoryCatalogSearch(
  search: string,
  documentLike?: CookieDocumentLike | null
): void {
  if (!documentLike) return;
  const normalized = search.trim();
  if (!normalized) {
    documentLike.cookie = `${FACTORY_CATALOG_SEARCH_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    return;
  }
  documentLike.cookie = `${FACTORY_CATALOG_SEARCH_COOKIE}=${encodeURIComponent(normalized)}; Path=/; Max-Age=3600; SameSite=Lax`;
}
