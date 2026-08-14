/**
 * Arabic translation import: the value rules, alongside the matching rules.
 *
 * factory-arabic-translation-workbook.test.ts covers how a row is matched to a
 * product and when the import is blocked. This file covers what happens to the
 * text itself once a row has matched: overwrite versus fill-missing, the length
 * limit, and the control characters Excel refuses to open a sheet containing.
 */
import { describe, expect, it } from "vitest";
import {
  createArabicTranslationPreviewEnvelope,
  createArabicTranslationPreviewToken,
  createWorkbookSha256,
  previewArabicTranslationImport,
  type TranslationCatalogProduct,
  type TranslationWorkbookRow,
} from "../server/services/factoryArabicTranslationWorkbook";

function product(overrides: Partial<TranslationCatalogProduct> = {}): TranslationCatalogProduct {
  return {
    id: 1,
    categoryId: 10,
    articleCode: "00123",
    name: "MEN BAG",
    nameAr: null,
    descriptionAr: null,
    categoryName: "BAGS",
    categoryNameAr: null,
    ...overrides,
  } as TranslationCatalogProduct;
}

function row(overrides: Partial<TranslationWorkbookRow> = {}): TranslationWorkbookRow {
  return {
    rowNumber: 2,
    articleCode: "00123",
    productNameAr: "حقيبة",
    categoryNameAr: "",
    descriptionAr: "",
    ...overrides,
  };
}

describe("translation values", () => {
  it("replaces an existing translation in overwrite mode", () => {
    const preview = previewArabicTranslationImport(
      [row({ productNameAr: "شنطة" })],
      [product({ nameAr: "حقيبة" })],
      "overwrite"
    );

    // The counterpart rule — fill-missing leaving the existing value alone — is
    // covered next to the matching rules; this is the other half of the switch.
    expect(preview.rows[0].targetProductNameAr).toBe("شنطة");
    expect(preview.rows[0].status).toBe("update");
  });

  it("rejects a translation longer than the column allows", () => {
    const preview = previewArabicTranslationImport(
      [row({ productNameAr: "ا".repeat(2001) })],
      [product()],
      "overwrite"
    );

    expect(preview.rows[0].status).toBe("invalid");
    expect(preview.rows[0].reasons.join(" ")).toContain("exceeds");
    expect(preview.rowsToApply).toBe(0);
  });

  it("accepts a translation exactly at the limit", () => {
    const preview = previewArabicTranslationImport(
      [row({ productNameAr: "ا".repeat(2000) })],
      [product()],
      "overwrite"
    );

    expect(preview.rows[0].status).toBe("update");
  });

  it("rejects a translation carrying control characters", () => {
    const preview = previewArabicTranslationImport(
      [row({ productNameAr: `حقيبة${String.fromCharCode(7)}` })],
      [product()],
      "overwrite"
    );

    // Excel refuses to open a workbook containing them, so a translation that
    // carries one has to be stopped before it reaches the catalogue and, from
    // there, the next exported sheet.
    expect(preview.rows[0].status).toBe("invalid");
    expect(preview.rows[0].reasons.join(" ")).toContain("control characters");
  });

  it("checks the category and description text by the same rules", () => {
    const preview = previewArabicTranslationImport(
      [row({ productNameAr: "", categoryNameAr: "ا".repeat(2001), descriptionAr: `وصف${String.fromCharCode(1)}` })],
      [product()],
      "overwrite"
    );

    const reasons = preview.rows[0].reasons.join(" ");
    expect(reasons).toContain("Arabic category name");
    expect(reasons).toContain("Arabic description");
  });

  it("counts an empty workbook as nothing to do rather than as a problem", () => {
    const preview = previewArabicTranslationImport([], [product()], "fill-missing");

    expect(preview.totalRows).toBe(0);
    expect(preview.rowsToApply).toBe(0);
    expect(preview.blocked).toBe(false);
  });
});

describe("workbook fingerprint", () => {
  it("hashes the same bytes to the same value and different bytes apart", () => {
    const first = createWorkbookSha256(Buffer.from("workbook-bytes"));

    expect(createWorkbookSha256(Buffer.from("workbook-bytes"))).toBe(first);
    expect(createWorkbookSha256(Buffer.from("other-bytes"))).not.toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("wraps the preview and its token into one envelope", () => {
    const preview = previewArabicTranslationImport([row()], [product()], "fill-missing");
    const input = { companyId: 4, mode: "fill-missing" as const, workbookSha256: "abc", preview };

    const envelope = createArabicTranslationPreviewEnvelope(input);

    expect(envelope.rows).toEqual(preview.rows);
    expect(envelope.previewToken).toBe(createArabicTranslationPreviewToken(input));
  });
});
