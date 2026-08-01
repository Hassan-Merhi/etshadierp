import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  ARABIC_TRANSLATION_TEMPLATE_HEADERS,
  createArabicTranslationTemplate,
  type TranslationCatalogProduct,
} from "../server/services/factoryArabicTranslationWorkbook";
import { isXlsxCellLocked } from "./helpers/xlsxProtection";

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
  {
    id: 2,
    categoryId: 10,
    articleCode: "ABC-2",
    name: "BELT",
    nameAr: "حزام",
    descriptionAr: null,
    categoryName: "BAGS",
    categoryNameAr: "حقائب",
  },
];

async function createBuffer() {
  return createArabicTranslationTemplate(products);
}

async function loadSheet() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await createBuffer()) as any);
  return workbook.worksheets[0];
}

async function xmlProtection(address: string): Promise<boolean> {
  const zip = await JSZip.loadAsync(await createBuffer());
  const sheetXml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  const stylesXml = await zip.file("xl/styles.xml")!.async("string");
  const cellTag = sheetXml.match(new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*>`))?.[0];
  expect(cellTag).toBeDefined();
  const styleId = Number(cellTag?.match(/\bs="(\d+)"/)?.[1] ?? 0);
  const cellXfs = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
  const styles = cellXfs.match(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g) ?? [];
  const style = styles[styleId] ?? "";
  return !/<protection\b[^>]*locked="0"/.test(style);
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

  it("diagnostic XML reference cell lock", async () => {
    await expect(xmlProtection("A2")).resolves.toBe(true);
  });

  it("diagnostic XML Arabic cell unlock", async () => {
    await expect(xmlProtection("C2")).resolves.toBe(false);
  });

  it("diagnostic shared helper reference lock", async () => {
    await expect(isXlsxCellLocked(await createBuffer(), "A2")).resolves.toBe(true);
  });
});
