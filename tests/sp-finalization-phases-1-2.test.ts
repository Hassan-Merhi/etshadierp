import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  adjustSpInventoryAtomic,
  requireSpInventoryMapping,
  SpInventoryIntegrityError,
} from "../server/services/sp/spInventoryIntegrity";
import {
  assertSpReleaseCurrency,
  SP_RELEASE_CURRENCY,
  SP_RELEASE_EXCHANGE_RATE,
  SP_RELEASE_POLICY,
} from "../server/services/sp/spReleasePolicy";

function routeSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Supplier Partner Phase 1 release policy", () => {
  it("freezes the USD-only accounting contract", () => {
    expect(Object.isFrozen(SP_RELEASE_POLICY)).toBe(true);
    expect(SP_RELEASE_POLICY.settlementCurrency).toBe("USD");
    expect(SP_RELEASE_POLICY.exchangeRate).toBe("1");
    expect(SP_RELEASE_POLICY.partialReturnsEnabled).toBe(false);
    expect(SP_RELEASE_POLICY.saleCorrection).toBe("full_reversal_only");
    expect(SP_RELEASE_POLICY.directSqlCorrectionsAllowed).toBe(false);
    expect(SP_RELEASE_CURRENCY).toBe("USD");
    expect(SP_RELEASE_EXCHANGE_RATE).toBe("1");
  });

  it("rejects non-USD or non-unit exchange-rate postings", () => {
    expect(() => assertSpReleaseCurrency("USD", 1)).not.toThrow();
    expect(() => assertSpReleaseCurrency("EUR", 1)).toThrow(/USD-only/);
    expect(() => assertSpReleaseCurrency("USD", 1.1)).toThrow(/exchange rate 1/);
  });
});

describe("Supplier Partner Phase 2 inventory integrity guard", () => {
  it("requires a stock item and location mapping before inventory is touched", async () => {
    const tx = { execute: vi.fn() };

    await expect(
      requireSpInventoryMapping(tx, {
        companyId: 7,
        stockItemId: null,
        locationId: 3,
        context: "test movement",
      }),
    ).rejects.toMatchObject<Partial<SpInventoryIntegrityError>>({
      code: "SP_INVENTORY_LINK_REQUIRED",
      statusCode: 409,
    });
    expect(tx.execute).not.toHaveBeenCalled();
  });

  it("rejects cross-company or missing stock-item mappings", async () => {
    const tx = { execute: vi.fn().mockResolvedValueOnce({ rows: [] }) };

    await expect(
      requireSpInventoryMapping(tx, {
        companyId: 7,
        stockItemId: 12,
        locationId: 3,
        context: "test movement",
      }),
    ).rejects.toMatchObject<Partial<SpInventoryIntegrityError>>({
      code: "SP_INVENTORY_LINK_REQUIRED",
      statusCode: 409,
    });
  });

  it("wraps inventory-engine failures instead of suppressing them", async () => {
    const tx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 12 }] })
        .mockResolvedValueOnce({ rows: [{ id: 3 }] })
        .mockRejectedValueOnce(new Error("inventory write unavailable")),
    };

    await expect(
      adjustSpInventoryAtomic(tx, {
        companyId: 7,
        stockItemId: 12,
        locationId: 3,
        deltaQty: 5,
        incomingRate: 20,
        context: "test offload",
      }),
    ).rejects.toMatchObject<Partial<SpInventoryIntegrityError>>({
      code: "SP_INVENTORY_POST_FAILED",
      statusCode: 500,
    });
  });

  it("keeps every SP stock-changing route on the atomic guard", () => {
    const paths = [
      "server/routes/sp/spSalesRoutes.ts",
      "server/routes/sp/spOpeningStockRoutes.ts",
      "server/routes/sp/spOffloadRoutes.ts",
    ];

    for (const path of paths) {
      const source = routeSource(path);
      expect(source, path).toContain("adjustSpInventoryAtomic");
      expect(source, path).toContain("respondToSpInventoryIntegrityError");
      expect(source, path).toContain("SP_RELEASE_CURRENCY");
      expect(source, path).not.toMatch(/non-blocking/i);
      expect(source, path).not.toMatch(/catch\s*\{\s*\/\*[^*]*inventory/i);
    }
  });
});
