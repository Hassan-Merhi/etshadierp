import ExcelJS from "exceljs";
import { normalizeFactoryArticleCode } from "@shared/factoryBilingualContract";

export type TranslationImportMode = "fill-missing" | "replace";

export interface TranslationCatalogProduct {
  id: number;
  categoryId: number | null;
  articleCode: string | null;
  name: string | null;
  nameAr: string | null;
  descriptionAr: string | null;
  categoryName: string | null;
  categoryNameAr: string | null;
}

export interface TranslationWorkbookRow {
  rowNumber: number;
  articleCode: string;
  productNameAr: string;
  categoryNameAr: string;
  descriptionAr: string;
}

export interface TranslationPreviewRow extends TranslationWorkbookRow {
  productId?: number;
  categoryId?: number | null;
  status: "update" | "unchanged" | "unknown" | "duplicate" | "invalid" | "category-conflict";
  reasons: string[];
}

export interface TranslationPreview {
  totalRows: number;
  matchedProducts: number;
  unchangedRows: number;
  productsToUpdate: number;
  categoriesToUpdate: number;
  unknownArticleCodes: string[];
  duplicateArticleCodes: string[];
  blankOrInvalidArabicNames: number;
  categoryConflicts: number;
  blocked: boolean;
  rows: TranslationPreviewRow[];
}

const HEADERS = [
  "Article Code / Barcode",
  "English Product Name",
  "Arabic Product Name",
  "English Category",
  "Arabic Category",
  "Arabic Description",
  "Current Translation Status",
] as const;

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && value && "text" in value) return String((value as any).text ?? "").trim();
  return String(value).trim();
}

export async function createArabicTranslationTemplate(products: TranslationCatalogProduct[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Arabic Names");
  sheet.columns = [
    { header: HEADERS[0], key: "articleCode", width: 24 },
    { header: HEADERS[1], key: "name", width: 36 },
    { header: HEADERS[2], key: "nameAr", width: 36 },
    { header: HEADERS[3], key: "categoryName", width: 28 },
    { header: HEADERS[4], key: "categoryNameAr", width: 28 },
    { header: HEADERS[5], key: "descriptionAr", width: 42 },
    { header: HEADERS[6], key: "status", width: 24 },
  ];
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.getRow(1).font = { bold: true };
  for (const product of products) {
    const row = sheet.addRow({
      articleCode: product.articleCode ?? "",
      name: product.name ?? "",
      nameAr: product.nameAr ?? "",
      categoryName: product.categoryName ?? "",
      categoryNameAr: product.categoryNameAr ?? "",
      descriptionAr: product.descriptionAr ?? "",
      status: product.nameAr && (!product.categoryId || product.categoryNameAr) ? "Complete" : "Missing Arabic",
    });
    row.getCell(1).numFmt = "@";
    row.getCell(1).value = String(product.articleCode ?? "");
    for (const column of [1, 2, 4, 7]) row.getCell(column).protection = { locked: true };
    for (const column of [3, 5, 6]) row.getCell(column).protection = { locked: false };
  }
  await sheet.protect("factory-arabic-template", { selectLockedCells: true, selectUnlockedCells: true });
  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data);
}

export async function parseArabicTranslationWorkbook(buffer: Buffer): Promise<TranslationWorkbookRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Workbook does not contain a worksheet");
  const actualHeaders = HEADERS.map((_, index) => text(sheet.getRow(1).getCell(index + 1).value));
  if (actualHeaders.some((value, index) => value !== HEADERS[index])) {
    throw new Error("Workbook columns do not match the Arabic translation template");
  }
  const rows: TranslationWorkbookRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const articleCode = normalizeFactoryArticleCode(text(row.getCell(1).value));
    const productNameAr = text(row.getCell(3).value);
    const categoryNameAr = text(row.getCell(5).value);
    const descriptionAr = text(row.getCell(6).value);
    if (!articleCode && !productNameAr && !categoryNameAr && !descriptionAr) return;
    rows.push({ rowNumber, articleCode, productNameAr, categoryNameAr, descriptionAr });
  });
  return rows;
}

export function previewArabicTranslationImport(
  rows: TranslationWorkbookRow[],
  products: TranslationCatalogProduct[],
  mode: TranslationImportMode
): TranslationPreview {
  const productByCode = new Map(products.map((product) => [normalizeFactoryArticleCode(product.articleCode), product]));
  const codeCounts = new Map<string, number>();
  for (const row of rows) codeCounts.set(row.articleCode, (codeCounts.get(row.articleCode) ?? 0) + 1);
  const categoryTranslations = new Map<number, Set<string>>();
  for (const row of rows) {
    const product = productByCode.get(row.articleCode);
    if (product?.categoryId && row.categoryNameAr) {
      const values = categoryTranslations.get(product.categoryId) ?? new Set<string>();
      values.add(row.categoryNameAr);
      categoryTranslations.set(product.categoryId, values);
    }
  }
  const conflictingCategoryIds = new Set([...categoryTranslations].filter(([, values]) => values.size > 1).map(([id]) => id));
  const previewRows: TranslationPreviewRow[] = rows.map((row) => {
    const reasons: string[] = [];
    const product = productByCode.get(row.articleCode);
    if (!row.articleCode) reasons.push("Missing article code");
    if ((codeCounts.get(row.articleCode) ?? 0) > 1) reasons.push("Duplicate article code in workbook");
    if (!product) reasons.push("Unknown article code");
    if (product?.categoryId && conflictingCategoryIds.has(product.categoryId)) reasons.push("Conflicting Arabic category translations");
    if (!row.productNameAr && !row.categoryNameAr && !row.descriptionAr) reasons.push("No Arabic translation supplied");
    let status: TranslationPreviewRow["status"] = "update";
    if (reasons.includes("Duplicate article code in workbook")) status = "duplicate";
    else if (reasons.includes("Unknown article code")) status = "unknown";
    else if (reasons.includes("Conflicting Arabic category translations")) status = "category-conflict";
    else if (reasons.length) status = "invalid";
    else if (product) {
      const productName = mode === "fill-missing" && product.nameAr ? product.nameAr : row.productNameAr || product.nameAr || "";
      const description = mode === "fill-missing" && product.descriptionAr ? product.descriptionAr : row.descriptionAr || product.descriptionAr || "";
      const categoryName = mode === "fill-missing" && product.categoryNameAr ? product.categoryNameAr : row.categoryNameAr || product.categoryNameAr || "";
      if (productName === (product.nameAr ?? "") && description === (product.descriptionAr ?? "") && categoryName === (product.categoryNameAr ?? "")) status = "unchanged";
    }
    return { ...row, productId: product?.id, categoryId: product?.categoryId, status, reasons };
  });
  const updateRows = previewRows.filter((row) => row.status === "update");
  const categoryIds = new Set(updateRows.filter((row) => row.categoryId && row.categoryNameAr).map((row) => row.categoryId as number));
  const duplicateArticleCodes = [...codeCounts].filter(([, count]) => count > 1).map(([code]) => code);
  const unknownArticleCodes = previewRows.filter((row) => row.status === "unknown").map((row) => row.articleCode);
  const blocked = duplicateArticleCodes.length > 0 || conflictingCategoryIds.size > 0;
  return {
    totalRows: rows.length,
    matchedProducts: previewRows.filter((row) => row.productId).length,
    unchangedRows: previewRows.filter((row) => row.status === "unchanged").length,
    productsToUpdate: updateRows.length,
    categoriesToUpdate: categoryIds.size,
    unknownArticleCodes,
    duplicateArticleCodes,
    blankOrInvalidArabicNames: previewRows.filter((row) => row.status === "invalid").length,
    categoryConflicts: conflictingCategoryIds.size,
    blocked,
    rows: previewRows,
  };
}

export async function createArabicTranslationErrorWorkbook(preview: TranslationPreview): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Rejected Rows");
  sheet.columns = [
    { header: "Row", key: "rowNumber", width: 10 },
    { header: "Article Code / Barcode", key: "articleCode", width: 24 },
    { header: "Arabic Product Name", key: "productNameAr", width: 36 },
    { header: "Arabic Category", key: "categoryNameAr", width: 30 },
    { header: "Arabic Description", key: "descriptionAr", width: 42 },
    { header: "Reasons", key: "reasons", width: 50 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const row of preview.rows.filter((item) => !["update", "unchanged"].includes(item.status))) {
    const excelRow = sheet.addRow({ ...row, reasons: row.reasons.join("; ") });
    excelRow.getCell(2).numFmt = "@";
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
