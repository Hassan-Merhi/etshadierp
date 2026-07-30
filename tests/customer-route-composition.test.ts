import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const compositionPath = path.resolve(root, "server/routes/customerRoutes.ts");
const legacyPath = path.resolve(root, "server/routes/customerRoutesLegacy.ts");

describe("customer route composition", () => {
  it("registers every focused customer domain in preserved order", () => {
    const source = fs.readFileSync(compositionPath, "utf8");
    const registrars = [
      "registerCustomerMasterRoutes(app)",
      "registerContainerSalesRoutes(app)",
      "registerCompanyTransferRoutes(app)",
    ];
    let previousIndex = -1;
    for (const registrar of registrars) {
      const index = source.indexOf(registrar);
      expect(index, `${registrar} must be present`).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
    expect(source).not.toContain("registerCustomerLegacyRoutes");
    expect(source).not.toContain("customerRoutesLegacy");
  });

  it("keeps the retired customer compatibility path deleted", () => {
    expect(fs.existsSync(legacyPath)).toBe(false);
  });
});
