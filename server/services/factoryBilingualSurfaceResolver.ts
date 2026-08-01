import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  normalizeFactoryArticleCode,
  resolveFactoryCategoryName,
  resolveFactoryProductLanguage,
  resolveFactorySnapshotProductName,
  type FactoryCatalogLanguage,
} from "@shared/factoryBilingualContract";

type CatalogRecord = {
  id: number;
  articleCode: string | null;
  name: string | null;
  nameAr: string | null;
  description: string | null;
  descriptionAr: string | null;
  categoryName: string | null;
  categoryNameAr: string | null;
};

type ResolveOptions = {
  mutateLegacyDisplayFields: boolean;
};

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result || null;
}

function numericId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function objectProductId(value: Record<string, unknown>): number | null {
  return numericId(value.productId ?? value.product_id ?? value.baleProductId ?? value.bale_product_id);
}

function objectArticleCode(value: Record<string, unknown>): string {
  return normalizeFactoryArticleCode(
    value.articleCode ?? value.article_code ?? value.productArticleCode ?? value.product_article_code
  );
}

function visit(value: unknown, callback: (record: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, callback);
    return;
  }
  if (!value || typeof value !== "object" || value instanceof Date || Buffer.isBuffer(value)) return;
  const record = value as Record<string, unknown>;
  callback(record);
  for (const child of Object.values(record)) visit(child, callback);
}

function rowsFromResult(result: unknown): CatalogRecord[] {
  if (Array.isArray(result)) return result as CatalogRecord[];
  const candidate = result as { rows?: unknown } | null;
  return Array.isArray(candidate?.rows) ? (candidate.rows as CatalogRecord[]) : [];
}

async function loadCatalog(
  companyId: number,
  productIds: number[],
  articleCodes: string[]
): Promise<{ byId: Map<number, CatalogRecord>; byArticleCode: Map<string, CatalogRecord> }> {
  if (productIds.length === 0 && articleCodes.length === 0) {
    return { byId: new Map(), byArticleCode: new Map() };
  }

  const result = await db.execute(sql`
    SELECT
      p.id,
      p.article_code AS "articleCode",
      p.name,
      p.name_ar AS "nameAr",
      p.description,
      p.description_ar AS "descriptionAr",
      c.name AS "categoryName",
      c.name_ar AS "categoryNameAr"
    FROM factory_bale_products p
    LEFT JOIN factory_categories c
      ON c.id = p.category_id
     AND c.company_id = p.company_id
     AND c.deleted_at IS NULL
    WHERE p.company_id = ${companyId}
      AND p.deleted_at IS NULL
      AND (
        p.id = ANY(${productIds.length ? productIds : [0]}::int[])
        OR UPPER(BTRIM(COALESCE(p.article_code, ''))) = ANY(${articleCodes.length ? articleCodes : ["__NONE__"]}::text[])
      )
  `);

  const byId = new Map<number, CatalogRecord>();
  const byArticleCode = new Map<string, CatalogRecord>();
  for (const row of rowsFromResult(result)) {
    byId.set(Number(row.id), row);
    const normalized = normalizeFactoryArticleCode(row.articleCode);
    if (normalized && !byArticleCode.has(normalized)) byArticleCode.set(normalized, row);
  }
  return { byId, byArticleCode };
}

function firstText(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const result = clean(record[key]);
    if (result) return result;
  }
  return null;
}

function setIfPresent(record: Record<string, unknown>, key: string, value: string): void {
  if (Object.prototype.hasOwnProperty.call(record, key)) record[key] = value;
}

function localizeRecord(
  record: Record<string, unknown>,
  catalog: CatalogRecord | null,
  language: FactoryCatalogLanguage,
  options: ResolveOptions
): void {
  const articleCode = objectArticleCode(record) || normalizeFactoryArticleCode(catalog?.articleCode);
  const englishSnapshot = firstText(record, [
    "productNameEn",
    "baleNameEn",
    "product_name_en",
    "bale_name_en",
    "productName",
    "baleName",
    "product_name",
    "bale_name",
  ]);
  const arabicSnapshot = firstText(record, [
    "productNameAr",
    "baleNameAr",
    "product_name_ar",
    "bale_name_ar",
  ]);

  let displayName = "";
  if (englishSnapshot || arabicSnapshot) {
    displayName = resolveFactorySnapshotProductName({
      language,
      snapshot: {
        articleCode,
        productNameEn: englishSnapshot,
        productNameAr: arabicSnapshot,
      },
      catalog: catalog
        ? { articleCode: catalog.articleCode, name: catalog.name, nameAr: catalog.nameAr }
        : null,
    });
  } else if (catalog || record.name || record.nameAr) {
    const resolved = resolveFactoryProductLanguage(
      {
        articleCode,
        name: clean(record.name) ?? catalog?.name,
        nameAr: clean(record.nameAr) ?? catalog?.nameAr,
        description: clean(record.description) ?? catalog?.description,
        descriptionAr: clean(record.descriptionAr) ?? catalog?.descriptionAr,
        categoryName:
          firstText(record, ["categoryName", "category", "category_name"]) ?? catalog?.categoryName,
        categoryNameAr:
          firstText(record, ["categoryNameAr", "categoryAr", "category_name_ar"]) ?? catalog?.categoryNameAr,
      },
      language
    );
    displayName = resolved.name;
    record.displayDescription = resolved.description;
    record.displayCategoryName = resolved.categoryName;
  }

  const categoryEnglish = firstText(record, ["categoryName", "category", "category_name"]) ?? catalog?.categoryName;
  const categoryArabic = firstText(record, ["categoryNameAr", "categoryAr", "category_name_ar"]) ?? catalog?.categoryNameAr;
  const displayCategory = resolveFactoryCategoryName(
    { name: categoryEnglish, nameAr: categoryArabic },
    language,
    articleCode
  );

  record.language = language;
  record.direction = language === "ar" ? "rtl" : "ltr";
  if (articleCode) record.normalizedArticleCode = articleCode;
  if (displayName) {
    record.displayName = displayName;
    record.displayProductName = displayName;
  }
  if (displayCategory) {
    record.displayCategory = displayCategory;
    record.displayCategoryName = displayCategory;
  }

  if (!options.mutateLegacyDisplayFields || !displayName) return;

  if (englishSnapshot && !record.productNameEn) record.productNameEn = englishSnapshot;
  if (englishSnapshot && !record.baleNameEn) record.baleNameEn = englishSnapshot;
  if (arabicSnapshot && !record.productNameAr) record.productNameAr = arabicSnapshot;
  if (arabicSnapshot && !record.baleNameAr) record.baleNameAr = arabicSnapshot;

  setIfPresent(record, "productName", displayName);
  setIfPresent(record, "baleName", displayName);
  setIfPresent(record, "product_name", displayName);
  setIfPresent(record, "bale_name", displayName);

  const looksLikeCatalogProduct = Boolean(articleCode) && ("name" in record || "nameAr" in record);
  if (looksLikeCatalogProduct) {
    if (!record.nameEn) record.nameEn = clean(record.name) ?? catalog?.name ?? null;
    record.name = displayName;
  }

  if (displayCategory) {
    setIfPresent(record, "category", displayCategory);
    setIfPresent(record, "categoryName", displayCategory);
    setIfPresent(record, "category_name", displayCategory);
  }
}

export async function resolveFactoryBilingualSurfacePayload(
  companyId: number,
  payload: unknown,
  language: FactoryCatalogLanguage,
  options: ResolveOptions
): Promise<unknown> {
  const productIds = new Set<number>();
  const articleCodes = new Set<string>();
  visit(payload, (record) => {
    const productId = objectProductId(record);
    const articleCode = objectArticleCode(record);
    if (productId) productIds.add(productId);
    if (articleCode) articleCodes.add(articleCode);
  });

  const catalog = await loadCatalog(companyId, [...productIds], [...articleCodes]);
  visit(payload, (record) => {
    const productId = objectProductId(record);
    const articleCode = objectArticleCode(record);
    const product = (productId ? catalog.byId.get(productId) : null) ??
      (articleCode ? catalog.byArticleCode.get(articleCode) : null) ??
      null;
    localizeRecord(record, product, language, options);
  });
  return payload;
}
