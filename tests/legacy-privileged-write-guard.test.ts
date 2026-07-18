import { describe, expect, it } from "vitest";
import {
  normalizeLegacyIdempotencyKey,
  shouldEnforceLegacyPrivilegedWrite,
} from "../server/services/security/legacyPrivilegedWriteGuard";

describe("legacy privileged write guard", () => {
  it("leaves preview requests available for confirmed-only routes", () => {
    expect(shouldEnforceLegacyPrivilegedWrite("confirmed-only", {})).toBe(false);
    expect(shouldEnforceLegacyPrivilegedWrite("confirmed-only", { confirm: false })).toBe(false);
  });

  it("enforces confirmed applies and direct writes", () => {
    expect(shouldEnforceLegacyPrivilegedWrite("confirmed-only", { confirm: true })).toBe(true);
    expect(shouldEnforceLegacyPrivilegedWrite("always", {})).toBe(true);
  });

  it("accepts bounded deterministic idempotency keys", () => {
    expect(normalizeLegacyIdempotencyKey("raw-stock:repair:123456")).toBe("raw-stock:repair:123456");
    expect(normalizeLegacyIdempotencyKey("  raw-stock.repair_123  ")).toBe("raw-stock.repair_123");
  });

  it("rejects missing, short, malformed, and oversized keys", () => {
    expect(normalizeLegacyIdempotencyKey(undefined)).toBe("");
    expect(normalizeLegacyIdempotencyKey("short")).toBe("");
    expect(normalizeLegacyIdempotencyKey("contains spaces")).toBe("");
    expect(normalizeLegacyIdempotencyKey("x".repeat(201))).toBe("");
  });
});
