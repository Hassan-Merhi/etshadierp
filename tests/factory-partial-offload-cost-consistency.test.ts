import fs from "node:fs";
import path from "node:path";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { resolveFactoryOffloadValuationKg } from "../shared/factoryOffloadValuation";
import { computeContainerLandedCost } from "../server/services/factory/containerLandedCost";
import { calculateMovingAverageRate } from "../server/services/factory/factoryCostingEngine";

const repoFile = (...parts: string[]) => fs.readFileSync(path.join(process.cwd(), ...parts), "utf8");

describe("partial offload cost consistency", () => {
  it("uses the agreed container quantity for both preview and persisted landed rate", () => {
    expect(
      resolveFactoryOffloadValuationKg({
        totalKg: "24000",
        declaredKg: "24000",
        receivedKg: "21340",
      })
    ).toBe(24000);

    const result = computeContainerLandedCost(
      {
        id: 1,
        companyId: 1,
        containerNumber: "CMAU7353468",
        currencyCode: "USD",
        fxRateToUsd: "1",
        fxRateToUsdOffload: "1",
        fxRateConfirmed: true,
        totalKg: "24000",
        declaredKg: "24000",
        actualReceivedKg: "21340",
        ratePerKg: "0.500000",
        freight: "648",
        freightCurrencyCode: "USD",
        otherCharges: "0",
        commissionAmount: "0",
        dutyStatus: "NONE",
        dutyAmount: "0",
      } as any,
      [],
      null,
      []
    );

    expect(result.valuationKg).toBe(24000);
    expect(result.costPerKgUsd).toBeCloseTo(0.527, 6);
  });

  it("keeps the supplier row as a true moving average using actual incoming kg and the canonical new rate", () => {
    const oldRemainingKg = new Decimal("122880");
    const oldLockedRate = new Decimal("0.630000");
    const incomingKg = new Decimal("21340");
    const canonicalIncomingRate = new Decimal("0.527000");

    const expected = oldRemainingKg
      .times(oldLockedRate)
      .plus(incomingKg.times(canonicalIncomingRate))
      .div(oldRemainingKg.plus(incomingKg));

    const actual = calculateMovingAverageRate({
      existingQuantityKg: oldRemainingKg,
      existingRatePerKg: oldLockedRate,
      incomingQuantityKg: incomingKg,
      incomingRatePerKg: canonicalIncomingRate,
    });

    expect(actual.toFixed(8)).toBe(expected.toFixed(8));
    expect(actual.toNumber()).not.toBe(canonicalIncomingRate.toNumber());
  });

  it("pins the UI preview, server offload, receipt history, and post-offload refresh to the same sources", () => {
    const dialog = repoFile(
      "client",
      "src",
      "pages",
      "factory",
      "production-raw-stock",
      "OffloadDialog.tsx"
    );
    const offloadRoute = repoFile(
      "server",
      "routes",
      "factory",
      "raw-stock",
      "rawStockOffloadRoutes.ts"
    );
    const historyRoute = repoFile(
      "server",
      "routes",
      "factory",
      "raw-stock",
      "rawStockAdjRoutes.ts"
    );
    const invalidation = repoFile(
      "client",
      "src",
      "pages",
      "factory",
      "factory-containers",
      "postoffloaddialog",
      "utils.ts"
    );

    expect(dialog).toContain("resolveFactoryOffloadValuationKg");
    expect(dialog).toContain("return totalUsd / valuationKg;");
    expect(dialog).not.toContain("return totalUsd / kg;");

    expect(offloadRoute).toContain("newReceivedKg: dReceivedKg.toNumber()");
    expect(offloadRoute).toContain("newContainerLandedCostPerKgUsd: dCostPerKgUsd.toNumber()");

    expect(historyRoute).toContain("costPerKg: parseFloat(r.costPerKgUsd as string)");
    expect(invalidation).toContain('key.startsWith("/api/factory/raw-stock/history/")');
  });
});
