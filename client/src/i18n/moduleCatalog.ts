import type { ApplicationLanguage } from "@shared/applicationLanguageContract";

/**
 * A module translation entry.
 *
 * English is required because it is the source text lifted out of the JSX.
 * French and Arabic are optional so a module can be converted to `t()` calls
 * before its translations have been reviewed — an entry without them renders
 * English rather than a key or an empty string.
 *
 * `scripts/audit-i18n-missing-translations.mjs` counts the entries still
 * missing fr or ar, so converting a module cannot make the rollout look
 * finished while its text is still English.
 */
export interface ModuleTranslationEntry {
  en: string;
  fr?: string;
  ar?: string;
}

export type ModuleCatalog = Record<string, ModuleTranslationEntry>;

export function resolveModuleText(catalog: ModuleCatalog, key: string, language: ApplicationLanguage): string {
  const entry = catalog[key];
  if (!entry) return key;
  if (language === "fr") return entry.fr || entry.en;
  if (language === "ar") return entry.ar || entry.en;
  return entry.en;
}

export function countMissingTranslations(catalog: ModuleCatalog): number {
  let missing = 0;
  for (const entry of Object.values(catalog)) {
    if (!entry.fr) missing += 1;
    if (!entry.ar) missing += 1;
  }
  return missing;
}
