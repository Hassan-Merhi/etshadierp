import { describe, expect, it } from "vitest";
import {
  buildPosSaleAdvisoryLockKey,
  normalizePosClientSaleId,
} from "../server/services/pos/posSaleIdempotency";

describe("POS sale idempotency policy", () => {
  it("treats absent retry identity as unprotected compatibility traffic", () => {
    expect(normalizePosClientSaleId(undefined)).toBeNull();
    expect(normalizePosClientSaleId(null)).toBeNull();
    expect(normalizePosClientSaleId("")).toBeNull();
  });

  it("preserves the exact provided client sale identity", () => {
    expect(normalizePosClientSaleId("sale-123")).toBe("sale-123");
    expect(normalizePosClientSaleId(123)).toBe("123");
  });

  it("uses a stable company-scoped advisory lock key", () => {
    expect(buildPosSaleAdvisoryLockKey(1, "sale-123")).toBe(
      buildPosSaleAdvisoryLockKey(1, "sale-123")
    );
    expect(buildPosSaleAdvisoryLockKey(1, "sale-123")).not.toBe(
      buildPosSaleAdvisoryLockKey(2, "sale-123")
    );
    expect(buildPosSaleAdvisoryLockKey(1, "sale-123")).not.toBe(
      buildPosSaleAdvisoryLockKey(1, "sale-456")
    );
  });
});
