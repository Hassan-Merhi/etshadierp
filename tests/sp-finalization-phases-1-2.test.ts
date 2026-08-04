import { describe, expect, it, vi } from "vitest";
import { adjustSpInventoryAtomic, requireSpInventoryMapping } from "../server/services/sp/spInventoryIntegrity";
import {
  assertSpReleaseCurrency,
  SP_RELEASE_CURRENCY,
  SP_RELEASE_EXCHANGE_RATE,
  SP_RELEASE_POLICY,
} from "../server/services/sp/spReleasePolicy";

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
    const tx = { execute: vi.fn() } as any;

    await expect(
      requireSpInventoryMapping(tx, {
        companyId: 7,
        stockItemId: null,
        locationId: 3,
        context: "test movement",
      })
    ).rejects.toMatchObject({
      code: "SP_INVENTORY_LINK_REQUIRED",
      statusCode: 409,
    });
    expect(tx.execute).not.toHaveBeenCalled();
  });

  it("rejects cross-company or missing stock-item mappings", async () => {
    const tx = { execute: vi.fn().mockResolvedValueOnce({ rows: [] }) } as any;

    await expect(
      requireSpInventoryMapping(tx, {
        companyId: 7,
        stockItemId: 12,
        locationId: 3,
        context: "test movement",
      })
    ).rejects.toMatchObject({
      code: "SP_INVENTORY_LINK_REQUIRED",
      statusCode: 409,
    });
  });

  it("accepts a company-owned stock item and active location", async () => {
    const tx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 12 }] })
        .mockResolvedValueOnce({ rows: [{ id: 3 }] }),
    } as any;

    await expect(
      requireSpInventoryMapping(tx, {
        companyId: 7,
        stockItemId: 12,
        locationId: 3,
        context: "test movement",
      })
    ).resolves.toEqual({ stockItemId: 12, locationId: 3 });
    expect(tx.execute).toHaveBeenCalledTimes(2);
  });

  it("wraps inventory-engine failures instead of suppressing them", async () => {
    const tx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 12 }] })
        .mockResolvedValueOnce({ rows: [{ id: 3 }] })
        .mockRejectedValueOnce(new Error("inventory write unavailable")),
    } as any;

    await expect(
      adjustSpInventoryAtomic(tx, {
        companyId: 7,
        stockItemId: 12,
        locationId: 3,
        deltaQty: 5,
        incomingRate: 20,
        context: "test offload",
      })
    ).rejects.toMatchObject({
      code: "SP_INVENTORY_POST_FAILED",
      statusCode: 500,
    });
  });
});
