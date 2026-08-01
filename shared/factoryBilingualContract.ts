export const FACTORY_CATALOG_LANGUAGES = ["en", "ar"] as const;

export type FactoryCatalogLanguage = (typeof FACTORY_CATALOG_LANGUAGES)[number];

export const FACTORY_ARABIC_IMPORT_MODES = ["fill-missing", "replace-existing"] as const;

export type FactoryArabicImportMode = (typeof FACTORY_ARABIC_IMPORT_MODES)[number];

export interface FactoryLocalizedTextSource {
  english?: string | null;
  arabic?: string | null;
  articleCode?: string | null;
}

export interface FactoryBilingualProductSource {
  articleCode?: string | null;
  name?: string | null;
  nameAr?: string | null;
  description?: string | null;
  descriptionAr?: string | null;
}

export interface FactoryBilingualCategorySource {
  name?: string | null;
  nameAr?: string | null;
}

export interface FactoryBilingualProductSnapshot {
  articleCode: string;
  productNameEn: string | null;
  productNameAr: string | null;
  categoryNameEn: string | null;
  categoryNameAr: string | null;
  descriptionEn: string | null;
  descriptionAr: string | null;
}

export interface FactoryArabicTranslationImportRow {
  articleCode: string;
  productNameAr: string | null;
  categoryNameAr: string | null;
  descriptionAr: string | null;
}

export interface FactorySnapshotResolutionInput {
  language: FactoryCatalogLanguage;
  snapshot: Pick<FactoryBilingualProductSnapshot, "articleCode" | "productNameEn" | "productNameAr">;
  catalog?: FactoryBilingualProductSource | null;
}

function cleanOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Article codes are language-neutral identifiers. Normalization is intentionally
 * conservative: trim surrounding whitespace and normalize case only. Punctuation
 * and leading zeroes are preserved so import matching cannot silently change a code.
 */
export function normalizeFactoryArticleCode(value: unknown): string {
  const cleaned = cleanOptionalText(value);
  return cleaned ? cleaned.toUpperCase() : "";
}

export function parseFactoryCatalogLanguage(
  value: unknown,
  fallback: FactoryCatalogLanguage = "en"
): FactoryCatalogLanguage {
  return value === "en" || value === "ar" ? value : fallback;
}

export function parseFactoryArabicImportMode(
  value: unknown,
  fallback: FactoryArabicImportMode = "fill-missing"
): FactoryArabicImportMode {
  return value === "fill-missing" || value === "replace-existing" ? value : fallback;
}

/**
 * Live catalog fallback:
 * - Arabic request: Arabic -> English -> article code
 * - English request: English -> Arabic -> article code
 */
export function resolveFactoryLocalizedText(
  source: FactoryLocalizedTextSource,
  language: FactoryCatalogLanguage
): string {
  const english = cleanOptionalText(source.english);
  const arabic = cleanOptionalText(source.arabic);
  const articleCode = normalizeFactoryArticleCode(source.articleCode);

  if (language === "ar") return arabic ?? english ?? articleCode;
  return english ?? arabic ?? articleCode;
}

export function resolveFactoryProductName(
  product: FactoryBilingualProductSource,
  language: FactoryCatalogLanguage
): string {
  return resolveFactoryLocalizedText(
    {
      english: product.name,
      arabic: product.nameAr,
      articleCode: product.articleCode,
    },
    language
  );
}

export function resolveFactoryProductDescription(
  product: FactoryBilingualProductSource,
  language: FactoryCatalogLanguage
): string {
  return resolveFactoryLocalizedText(
    {
      english: product.description,
      arabic: product.descriptionAr,
      articleCode: product.articleCode,
    },
    language
  );
}

export function resolveFactoryCategoryName(
  category: FactoryBilingualCategorySource,
  language: FactoryCatalogLanguage,
  articleCode?: string | null
): string {
  return resolveFactoryLocalizedText(
    {
      english: category.name,
      arabic: category.nameAr,
      articleCode,
    },
    language
  );
}

/**
 * Finalized documents must prefer stored snapshots over the current catalog.
 * The opposite-language snapshot is preferred before any current catalog value
 * so a later catalog rename cannot silently rename a historical document.
 */
export function resolveFactorySnapshotProductName(input: FactorySnapshotResolutionInput): string {
  const snapshotRequested = cleanOptionalText(
    input.language === "ar" ? input.snapshot.productNameAr : input.snapshot.productNameEn
  );
  const snapshotOpposite = cleanOptionalText(
    input.language === "ar" ? input.snapshot.productNameEn : input.snapshot.productNameAr
  );
  if (snapshotRequested) return snapshotRequested;
  if (snapshotOpposite) return snapshotOpposite;

  if (input.catalog) {
    const catalogResolved = resolveFactoryProductName(input.catalog, input.language);
    if (catalogResolved) return catalogResolved;
  }

  return normalizeFactoryArticleCode(input.snapshot.articleCode);
}

export function buildFactoryBilingualProductSnapshot(input: {
  product: FactoryBilingualProductSource;
  category?: FactoryBilingualCategorySource | null;
}): FactoryBilingualProductSnapshot {
  return {
    articleCode: normalizeFactoryArticleCode(input.product.articleCode),
    productNameEn: cleanOptionalText(input.product.name),
    productNameAr: cleanOptionalText(input.product.nameAr),
    categoryNameEn: cleanOptionalText(input.category?.name),
    categoryNameAr: cleanOptionalText(input.category?.nameAr),
    descriptionEn: cleanOptionalText(input.product.description),
    descriptionAr: cleanOptionalText(input.product.descriptionAr),
  };
}

export function normalizeFactoryArabicTranslationImportRow(input: {
  articleCode: unknown;
  productNameAr?: unknown;
  categoryNameAr?: unknown;
  descriptionAr?: unknown;
}): FactoryArabicTranslationImportRow {
  return {
    articleCode: normalizeFactoryArticleCode(input.articleCode),
    productNameAr: cleanOptionalText(input.productNameAr),
    categoryNameAr: cleanOptionalText(input.categoryNameAr),
    descriptionAr: cleanOptionalText(input.descriptionAr),
  };
}
