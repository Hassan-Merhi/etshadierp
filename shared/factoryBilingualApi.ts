import {
  parseFactoryCatalogLanguage,
  resolveFactoryCategoryName,
  resolveFactoryProductDescription,
  resolveFactoryProductName,
  type FactoryBilingualCategorySource,
  type FactoryBilingualProductSource,
  type FactoryCatalogLanguage,
} from "./factoryBilingualContract";

export interface FactoryBilingualCategoryApiRecord extends FactoryBilingualCategorySource {
  id?: number;
  companyId?: number;
  [key: string]: unknown;
}

export interface FactoryBilingualProductApiRecord extends FactoryBilingualProductSource {
  id?: number;
  companyId?: number;
  categoryId?: number | null;
  category?: FactoryBilingualCategoryApiRecord | null;
  categoryName?: string | null;
  categoryNameAr?: string | null;
  [key: string]: unknown;
}

export interface FactoryResolvedCategoryApiRecord extends FactoryBilingualCategoryApiRecord {
  displayName: string;
  language: FactoryCatalogLanguage;
}

export interface FactoryResolvedProductApiRecord extends FactoryBilingualProductApiRecord {
  displayName: string;
  displayDescription: string;
  displayCategoryName: string;
  language: FactoryCatalogLanguage;
}

function normalizedSearchText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
}

export function resolveFactoryCategoryApiRecord(
  category: FactoryBilingualCategoryApiRecord,
  requestedLanguage: unknown
): FactoryResolvedCategoryApiRecord {
  const language = parseFactoryCatalogLanguage(requestedLanguage);
  return {
    ...category,
    language,
    displayName: resolveFactoryCategoryName(category, language),
  };
}

export function resolveFactoryProductApiRecord(
  product: FactoryBilingualProductApiRecord,
  requestedLanguage: unknown
): FactoryResolvedProductApiRecord {
  const language = parseFactoryCatalogLanguage(requestedLanguage);
  const category: FactoryBilingualCategorySource = product.category ?? {
    name: product.categoryName,
    nameAr: product.categoryNameAr,
  };

  return {
    ...product,
    language,
    displayName: resolveFactoryProductName(product, language),
    displayDescription: resolveFactoryProductDescription(product, language),
    displayCategoryName: resolveFactoryCategoryName(category, language, product.articleCode),
  };
}

/**
 * Language-neutral catalog search. Every searchable field is considered regardless
 * of the requested display language, while article-code lookup remains exact in
 * barcode/scanner flows outside this helper.
 */
export function factoryProductMatchesSearch(
  product: FactoryBilingualProductApiRecord,
  rawQuery: unknown
): boolean {
  const query = normalizedSearchText(rawQuery);
  if (!query) return true;

  const category = product.category;
  const values = [
    product.articleCode,
    product.name,
    product.nameAr,
    product.description,
    product.descriptionAr,
    category?.name ?? product.categoryName,
    category?.nameAr ?? product.categoryNameAr,
  ];

  return values.some((value) => normalizedSearchText(value).includes(query));
}

export function filterFactoryProductsBySearch<T extends FactoryBilingualProductApiRecord>(
  products: readonly T[],
  rawQuery: unknown
): T[] {
  return products.filter((product) => factoryProductMatchesSearch(product, rawQuery));
}
