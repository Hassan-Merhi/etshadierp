import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("POS negative-stock permission wiring", () => {
  it("refreshes active-company authentication before rendering a switched company", () => {
    const context = source("client/src/contexts/CompanyContext.tsx");

    const authRefresh = context.indexOf('queryKey: ["/api/auth/me"]');
    const companyCommit = context.indexOf(
      "commitCompanySelection(company, { prefetch: true, serverSynced: true })",
    );

    expect(authRefresh).toBeGreaterThan(-1);
    expect(companyCommit).toBeGreaterThan(authRefresh);
    expect(context).toContain('refetchType: "active"');
  });

  it("uses the refreshed session permission as the frontend source of truth", () => {
    const calculations = source("client/src/pages/pos/hooks/usePosRowCalculations.ts");

    expect(calculations).toContain(
      "authUser?.canSellNegativeStock ?? posUser?.canSellNegativeStock ?? false",
    );
    expect(calculations).toContain("availableStock <= 0 && !canSellNegativeStock");
  });

  it("keeps the server-side stock check authoritative", () => {
    const routes = source("server/routes/pos/index.ts");
    const inventory = source("server/services/pos/deductSaleInventory.ts");

    expect(routes).toContain("enforcePosOperationalPermissionScope");
    expect(inventory).toContain("lockedQty < saleQty && !canSellNegativeStock");
  });
});
