import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  ARABIC_TRANSLATION_TEMPLATE_HEADERS,
  createArabicTranslationTemplate,
  type TranslationCatalogProduct,
} from "../server/services/factoryArabicTranslationWorkbook";

const products: TranslationCatalogProduct[] = [
  {
    id: 1,
    categoryId: 10,
    articleCode: "00123",
    name: "MEN BAG",
    nameAr: null,
    descriptionAr: null,
    categoryName: "BAGS",
    categoryNameAr: null,
  },
];

async function loadSheet() {
  const buffer = await createArabicTranslationTemplate(products);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  return workbook.worksheets[0];
}

describe("Factory Arabic workbook export diagnostics", () => {
  it("diagnostic headers", async () => {
    const sheet = await loadSheet();
    expect(
      ARABIC_TRANSLATION_TEMPLATE_HEADERS.map((_, index) =>
        String(sheet.getRow(1).getCell(index + 1).value)
      )
    ).toEqual([...ARABIC_TRANSLATION_TEMPLATE_HEADERS]);
  });

  it("diagnostic article code text format", async () => {
    const sheet = await loadSheet();
    expect(sheet.getRow(2).getCell(1).numFmt).toBe("@");
  });

  it("diagnostic article code value", async () => {
    const sheet = await loadSheet();
    expect(sheet.getRow(2).getCell(1).value).toBe("00123");
  });

  it("diagnostic reference cell lock", async () => {
    const sheet = await loadSheet();
    expect(sheet.getRow(2).getCell(1).protection.locked).not.toBe(false);
  });

  it("diagnostic Arabic cell unlock", async () => {
    const sheet = await loadSheet();
    expect(sheet.getRow(2).getCell(3).protection.locked).toBe(false);
  });
});
