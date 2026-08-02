export const APPLICATION_LANGUAGES = ["en", "ar", "fr"] as const;

export type ApplicationLanguage = (typeof APPLICATION_LANGUAGES)[number];

export const DEFAULT_APPLICATION_LANGUAGE: ApplicationLanguage = "en";

export function isApplicationLanguage(value: unknown): value is ApplicationLanguage {
  return typeof value === "string" && APPLICATION_LANGUAGES.includes(value as ApplicationLanguage);
}

export function parseApplicationLanguage(value: unknown): ApplicationLanguage {
  return isApplicationLanguage(value) ? value : DEFAULT_APPLICATION_LANGUAGE;
}

export function isRtlApplicationLanguage(language: ApplicationLanguage): boolean {
  return language === "ar";
}

/**
 * Business identifiers and user-entered master-data names are deliberately not
 * translated by the UI dictionary. Stock item names, stock group names,
 * article codes, account codes, container numbers, voucher numbers and other
 * persisted identifiers must be rendered from their stored values or explicit
 * multilingual database fields.
 */
export const TRANSLATION_PROTECTED_DATA_FIELDS = [
  "articleCode",
  "barcode",
  "stockItemName",
  "stockGroupName",
  "accountCode",
  "containerNumber",
  "voucherNumber",
] as const;

export const APPLICATION_LANGUAGE_STORAGE_KEY = "erp.application-language";
export const APPLICATION_LANGUAGE_COOKIE = "erp_application_language";
export const APPLICATION_LANGUAGE_EVENT = "erp:application-language-change";
