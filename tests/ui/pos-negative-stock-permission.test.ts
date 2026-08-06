import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("POS negative-stock permission wiring", () => {
  it("resets active-company authentication when company data is cleared", () => {
    const queryScope = source("client/src/lib/companyQueryScope.ts");

    expect(queryScope).toContain('queryKey: ["/api/auth/me"]');
    expect(queryScope).toContain("client.resetQueries");
  });

  it("uses the refreshed session permission as the frontend source of truth", () => {
    const calculations = source(
      "client/src/pages/pos/hooks/usePosRowCalculations.ts",
    );

    expect(calculations).toContain(
      "authUser?.canSellNegativeStock ?? posUser?.canSellNegativeStock ?? false",
    );
    expect(calculations).toContain("availableStock <= 0");
    expect(calculations).toContain("!canSellNegativeStock");
  });

  it("keeps the server-side stock check authoritative", () => {
    const routes = source("server/routes/pos/index.ts");
    const inventory = source("server/services/pos/deductSaleInventory.ts");

    expect(routes).toContain("enforcePosOperationalPermissionScope");
    expect(inventory).toContain(
      "lockedQuantity.lessThan(requestedQuantity) && !canSellNegativeStock",
    );
    expect(inventory).toContain("FOR UPDATE OF i");
  });
});
