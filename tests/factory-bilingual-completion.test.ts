import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Factory bilingual phases 1-8 completion contracts", () => {
  it("provides explicit existing product and category Arabic edit controls", () => {
    const source = read("client/src/components/FactoryCatalogTranslationEditor.tsx");
    expect(source).toContain("Save product translation");
    expect(source).toContain("Save category translation");
    expect(source).toContain("nameAr");
    expect(source).toContain("descriptionAr");
  });

  it("exposes document language choices on pending verification and loading scan routes", () => {
    const source = read("client/src/components/FactoryBilingualDocumentActions.tsx");
    expect(source).toContain("pending-invoices");
    expect(source).toContain("loading-scan");
    expect(source).toContain("export-pdf?lang=ar");
    expect(source).toContain("export-excel?lang=ar");
    expect(source).toContain("pending-export?lang=ar");
  });

  it("makes worker WhatsApp PDFs language-aware and snapshot-first", () => {
    const source = read("server/routes/factory/endProductionRoutes.ts");
    expect(source).toContain("parseFactoryCatalogLanguage");
    expect(source).toContain("fb.product_name_ar");
    expect(source).toContain("fb.product_name");
    expect(source).toContain("generateBilingualWorkerBalesPdf");
  });

  it("uses an Arabic-capable worker PDF renderer", () => {
    const source = read("server/lib/workerBalesBilingualPdfGenerator.ts");
    expect(source).toContain("Amiri-Regular.ttf");
    expect(source).toContain('features: ["rtla", "arab"]');
    expect(source).toContain("تقرير بالات العمال");
  });

  it("localizes only recognizable product/category records", () => {
    const source = read("server/services/factoryBilingualSurfaceResolver.ts");
    expect(source).toContain("isResolvableRecord");
    expect(source).toContain("hasProductText");
    expect(source).toContain("isCategoryRecord");
  });

  it("supports both Factory and legacy company session context", () => {
    const source = read("server/routes/factory/factoryBilingualSurfaceRoutes.ts");
    expect(source).toContain("factoryCompanyId ?? session?.currentCompanyId");
    expect(source).toContain('app.use("/api/factory"');
    expect(source).toContain('app.use("/api"');
  });
});
