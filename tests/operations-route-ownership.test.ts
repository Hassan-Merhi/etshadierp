import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Phase 7 operations route ownership", () => {
  it("keeps operational registration in focused application registrars", () => {
    const applicationRoutes = read("server/routes/applicationRoutes.ts");

    const expectedRegistrations = [
      "registerLocationRoutes(app);",
      "registerEmployeeRoutes(app);",
      "registerStockRoutes(app);",
      "registerContainerRoutes(app);",
      "registerImportRoutes(app);",
      "registerPosRoutes(app);",
      "registerBaleRoutes(app);",
      "registerPropertiesRentalRoutes(app);",
      "registerErpRentalRoutes(app);",
      "registerFactoryRentalRoutes(app);",
      "registerFactoryRoutes(app, requireAuth, db);",
      "registerGlobalTransactionRoutes(app, requireAuth);",
      "registerFiscalTransferRoutes(app);",
    ];

    for (const registration of expectedRegistrations) {
      expect(applicationRoutes).toContain(registration);
    }
  });

  it("prevents operations HTTP ownership from returning to routesLegacy", () => {
    const legacyRoutes = read("server/routesLegacy.ts");
    const boundaries = read("config/legacy-route-boundaries.json");

    expect(legacyRoutes).not.toMatch(/\bapp\.(get|post|put|patch|delete|use)\s*\(/);
    expect(legacyRoutes).not.toMatch(
      /register(Location|Employee|Stock|Container|Import|Pos|Bale|PropertiesRental|ErpRental|FactoryRental|Factory|GlobalTransaction|FiscalTransfer)Routes/,
    );
    expect(boundaries).toContain("no operations HTTP ownership");
  });
});
