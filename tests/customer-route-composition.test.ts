import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const compositionPath = path.resolve(process.cwd(), "server/routes/customerRoutes.ts");
const legacyPath = path.resolve(process.cwd(), "server/routes/customerRoutesLegacy.ts");

describe("customer route composition", () => {
  it("registers every focused customer domain", () => {
    const source = fs.readFileSync(compositionPath, "utf8");

    expect(source).toContain("registerCustomerMasterRoutes(app)");
    expect(source).toContain("registerContainerSalesRoutes(app)");
    expect(source).toContain("registerCompanyTransferRoutes(app)");
    expect(source).not.toContain("registerCustomerLegacyRoutes");
  });

  it("keeps the customer compatibility registrar fully retired", () => {
    const source = fs.readFileSync(compositionPath, "utf8");

    expect(fs.existsSync(legacyPath)).toBe(false);
    expect(source).not.toContain("customerRoutesLegacy");
  });
});
