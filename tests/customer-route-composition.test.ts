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

  it("keeps the customer legacy boundary free of HTTP handlers", () => {
    const source = fs.readFileSync(legacyPath, "utf8");

    expect(source).not.toMatch(/app\.(get|post|put|patch|delete)\(/);
    expect(source).toContain("registerCustomerRoutes(_app: Express)");
  });
});
