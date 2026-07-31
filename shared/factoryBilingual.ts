export type FactoryLanguage = "en" | "ar";

export interface BilingualTextSource {
  en?: string | null;
  ar?: string | null;
  fallback?: string | null;
}

function clean(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeFactoryLanguage(value: unknown): FactoryLanguage {
  return typeof value === "string" && value.toLowerCase() === "ar" ? "ar" : "en";
}

export function resolveFactoryText(
  source: BilingualTextSource,
  language: FactoryLanguage
): string {
  const english = clean(source.en);
  const arabic = clean(source.ar);
  const fallback = clean(source.fallback) ?? "";

  if (language === "ar") return arabic ?? english ?? fallback;
  return english ?? arabic ?? fallback;
}

export interface FactoryProductLanguageSource {
  articleCode?: string | null;
  name?: string | null;
  nameAr?: string | null;
  description?: string | null;
  descriptionAr?: string | null;
  categoryName?: string | null;
  categoryNameAr?: string | null;
}

export function resolveFactoryProductLanguage(
  product: FactoryProductLanguageSource,
  language: FactoryLanguage
) {
  const articleCode = clean(product.articleCode) ?? "";
  return {
    language,
    articleCode,
    name: resolveFactoryText(
      { en: product.name, ar: product.nameAr, fallback: articleCode },
      language
    ),
    categoryName: resolveFactoryText(
      { en: product.categoryName, ar: product.categoryNameAr, fallback: articleCode },
      language
    ),
    description: resolveFactoryText(
      { en: product.description, ar: product.descriptionAr, fallback: "" },
      language
    ),
  };
}

export function factorySearchValues(product: FactoryProductLanguageSource): string[] {
  return [
    product.articleCode,
    product.name,
    product.nameAr,
    product.categoryName,
    product.categoryNameAr,
  ]
    .map(clean)
    .filter((value): value is string => Boolean(value));
}
