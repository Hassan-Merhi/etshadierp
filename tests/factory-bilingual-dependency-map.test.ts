import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface DependencyGroup {
  id: string;
  targetPhase: number;
  files: string[];
}

interface DependencyManifest {
  version: number;
  issue: number;
  scope: string;
  rules: Record<string, unknown>;
  groups: DependencyGroup[];
}

const root = process.cwd();
const manifestPath = path.join(root, "config/factory-bilingual-dependencies.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as DependencyManifest;
const allFiles = manifest.groups.flatMap((group) => group.files);
const criticalFiles = [
  "shared/schema/factory.ts",
  "shared/factoryBilingualContract.ts",
  "server/routes/factory/factoryProductsRoutes.ts",
  "client/src/pages/BaleProducts.tsx",
  "client/src/pages/factory/factoryimport/components/BaleImport.tsx",
  "server/routes/factory/factoryBalesRoutes.ts",
  "server/routes/factory/factoryCustomerProformaRoutes.ts",
  "server/routes/factory/customer-orders/orderHelpers.ts",
  "server/routes/factory/customer-orders/baleScanningRoutes.ts",
  "server/routes/factory/customer-orders/orderPdfExportRoutes.ts",
  "server/routes/factory/customer-orders/orderExcelExportRoutes.ts",
  "server/routes/factory/factoryInvoiceLoadingRoutes.ts",
  "client/src/pages/factory/BalesHistory.tsx",
];

describe("factory bilingual dependency map", () => {
  it("is tied to the approved bilingual Factory issue and contract", () => {
    expect(manifest.version).toBe(1);
    expect(manifest.issue).toBe(347);
    expect(manifest.scope).toContain("Factory bale product/category names");
    expect(manifest.rules.languages).toEqual(["en", "ar"]);
  });

  it("uses unique group identifiers and unique file ownership", () => {
    const groupIds = manifest.groups.map((group) => group.id);

    expect(new Set(groupIds).size).toBe(groupIds.length);
    expect(new Set(allFiles).size).toBe(allFiles.length);
  });

  it("covers existing high-risk catalog, snapshot, import, and document boundaries", () => {
    const missingCriticalFiles = criticalFiles.filter((file) => !fs.existsSync(path.join(root, file)));

    expect(missingCriticalFiles).toEqual([]);
    expect(allFiles).toEqual(expect.arrayContaining(criticalFiles));
  });

  it("assigns every dependency to a remaining implementation phase", () => {
    for (const group of manifest.groups) {
      expect(group.targetPhase).toBeGreaterThanOrEqual(2);
      expect(group.targetPhase).toBeLessThanOrEqual(8);
      expect(group.files.length).toBeGreaterThan(0);
    }
  });
});
