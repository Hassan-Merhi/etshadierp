import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("factory loading proforma quantity alignment", () => {
  it("manual scanning uses the summed proforma target", () => {
    const source = read("server/routes/factory/customer-orders/bale-scanning/scan.ts");
    expect(source).toContain("sumProformaQuantityLimit(matchingProformaLines)");
    expect(source).toContain("currentCount >= proformaQuantityLimit");
  });

  it("factory loading requests sibling-aware remaining quantities", () => {
    const source = read("client/src/pages/factory/factorycontainerloadingscan/useFactoryContainerLoadingScanModel.ts");
    expect(source).toContain("continuationFromOrderId || String(orderId)");
  });

  it("remaining quantities normalize article codes", () => {
    const source = read("server/routes/factory/customer-orders/orderCrudRoutes.ts");
    expect(source).toContain("normalizedArticleCode");
    expect(source).toContain("trim().toLowerCase()");
  });
});
