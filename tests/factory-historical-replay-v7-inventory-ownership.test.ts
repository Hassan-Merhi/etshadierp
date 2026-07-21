/**
 * Phase V7 — Inventory Ownership: focused tests for the inventory_supplier_id
 * mechanism and the zero-inventory boundary reset in replaySupplierTimeline.
 *
 * Run with:  npx vitest run tests/factory-historical-replay-v7-*
 *
 * These tests exercise only the pure timeline math (no DB required for most)
 * and the schema / helper utilities introduced in Phase V7.
 */

import { describe, expect, it } from "vitest";
import {
  replaySupplierTimeline,
} from "../server/services/factory/historicalCostReplay";
import {
  resolveInventorySupplierId,
  requireInventorySupplierId,
} from "../server/services/factory/mixSourceInventoryOwnership";
import { REPLAY_ALGORITHM_VERSION } from "../server/services/factory/historical-replay/types";

// ── 1. Algorithm version ──────────────────────────────────────────────────────

describe("REPLAY_ALGORITHM_VERSION", () => {
  it("is V7 and invalidates old v6 tokens", () => {
    expect(REPLAY_ALGORITHM_VERSION).toBe("HISTORICAL_COST_REPLAY_V7_INVENTORY_OWNERSHIP");
    expect(REPLAY_ALGORITHM_VERSION).not.toContain("v6");
  });
});

// ── 2. resolveInventorySupplierId ─────────────────────────────────────────────

describe("resolveInventorySupplierId", () => {
  it("returns null for BATCH sources (sourceBatchId set)", () => {
    expect(resolveInventorySupplierId({ sourceBatchId: 42, supplierId: null, containerId: null })).toBeNull();
    expect(resolveInventorySupplierId({ sourceBatchId: 1, supplierId: 99, containerId: 7 })).toBeNull();
  });

  it("returns supplierId for SUPPLIER_LOCKED_RATE sources", () => {
    expect(resolveInventorySupplierId({ supplierId: 5, containerId: null, sourceBatchId: null })).toBe(5);
    expect(resolveInventorySupplierId({ supplierId: 5, containerId: 10, sourceBatchId: null })).toBe(5);
  });

  it("returns containerSupplierId for CONTAINER_DIRECT sources", () => {
    expect(resolveInventorySupplierId({ supplierId: null, containerId: 10, sourceBatchId: null, containerSupplierId: 7 })).toBe(7);
  });

  it("returns null when container has no supplier", () => {
    expect(resolveInventorySupplierId({ supplierId: null, containerId: 10, sourceBatchId: null, containerSupplierId: null })).toBeNull();
    expect(resolveInventorySupplierId({ supplierId: null, containerId: 10, sourceBatchId: null })).toBeNull();
  });

  it("returns null when no context at all", () => {
    expect(resolveInventorySupplierId({ supplierId: null, containerId: null, sourceBatchId: null })).toBeNull();
  });
});

// ── 3. requireInventorySupplierId ─────────────────────────────────────────────

describe("requireInventorySupplierId", () => {
  it("does not throw for BATCH sources with null inventorySupplierId", () => {
    expect(() => requireInventorySupplierId(null, 42)).not.toThrow();
  });

  it("does not throw when inventorySupplierId is resolved", () => {
    expect(() => requireInventorySupplierId(5, null)).not.toThrow();
    expect(() => requireInventorySupplierId(5, undefined)).not.toThrow();
  });

  it("throws INVENTORY_SUPPLIER_UNRESOLVED when null and not BATCH", () => {
    expect(() => requireInventorySupplierId(null, null)).toThrow("INVENTORY_SUPPLIER_UNRESOLVED");
    expect(() => requireInventorySupplierId(null, undefined)).toThrow("INVENTORY_SUPPLIER_UNRESOLVED");
  });
});

// ── 4. Zero-inventory boundary reset ─────────────────────────────────────────

describe("replaySupplierTimeline — zero-inventory boundary reset", () => {
  it("resets to new receipt rate when remaining exactly hits zero before next receipt", async () => {
    // consume 100 kg fully, then receive at a different rate → new rate should win
    const result = await replaySupplierTimeline(1, 1, "S", 0, [
      { kind: "RECEIPT", effectiveDate: "2025-01-01", createdAt: 1, stableId: 1, receiptKg: 100, canonicalRateUsd: 2 },
      { kind: "BATCH_CONSUMPTION", effectiveDate: "2025-01-02", createdAt: 2, stableId: 2, batchId: 10, consumptionKg: 100 },
      { kind: "RECEIPT", effectiveDate: "2025-01-03", createdAt: 3, stableId: 3, receiptKg: 50, canonicalRateUsd: 4 },
    ] as any, 50);
    expect(result.endingRate).toBe(4);
    expect(result.replayRemainingKg).toBe(50);
  });

  it("clamps tiny rounding residuals to zero before next receipt", async () => {
    // 100 received, 100.0005 consumed (rounding residual of -0.0005)
    // Next receipt at rate 5 should win fully (not blend against -0.0005 remaining)
    const result = await replaySupplierTimeline(1, 2, "S2", 0, [
      { kind: "RECEIPT", effectiveDate: "2025-02-01", createdAt: 1, stableId: 1, receiptKg: 100, canonicalRateUsd: 2 },
      { kind: "BATCH_CONSUMPTION", effectiveDate: "2025-02-02", createdAt: 2, stableId: 2, batchId: 11, consumptionKg: 100.0005 },
      { kind: "RECEIPT", effectiveDate: "2025-02-03", createdAt: 3, stableId: 3, receiptKg: 80, canonicalRateUsd: 5 },
    ] as any, 80);
    // remaining before second receipt = 0 (clamped), so rate = 5
    expect(result.endingRate).toBe(5);
    expect(result.replayRemainingKg).toBe(80);
  });

  it("does NOT clamp residuals larger than 0.001 kg", async () => {
    // 100 received, 98 consumed → 2 kg remaining (not clamped)
    // next receipt blends 2 kg @$2 + 50 kg @$5 = ($4 + $250) / 52 ≈ $4.923
    const result = await replaySupplierTimeline(1, 3, "S3", 0, [
      { kind: "RECEIPT", effectiveDate: "2025-03-01", createdAt: 1, stableId: 1, receiptKg: 100, canonicalRateUsd: 2 },
      { kind: "BATCH_CONSUMPTION", effectiveDate: "2025-03-02", createdAt: 2, stableId: 2, batchId: 12, consumptionKg: 98 },
      { kind: "RECEIPT", effectiveDate: "2025-03-03", createdAt: 3, stableId: 3, receiptKg: 50, canonicalRateUsd: 5 },
    ] as any, 52);
    // blended = (2*2 + 50*5) / 52 ≈ 4.923
    expect(result.endingRate).toBeCloseTo((2 * 2 + 50 * 5) / 52, 4);
    expect(result.replayRemainingKg).toBe(52);
  });

  it("preserves negative remaining (known over-consumption) and resets rate at next receipt", async () => {
    // This is the existing negative-stock test pattern from factory-historical-replay-negative-stock.test.ts
    const result = await replaySupplierTimeline(7, 1, "Supplier", 0, [
      { kind: "RECEIPT", effectiveDate: "2026-01-01", createdAt: 1, stableId: 1, receiptKg: 100, canonicalRateUsd: 2 },
      { kind: "BATCH_CONSUMPTION", effectiveDate: "2026-01-02", createdAt: 2, stableId: 2, batchId: 2, consumptionKg: 150 },
      { kind: "RECEIPT", effectiveDate: "2026-01-03", createdAt: 3, stableId: 3, receiptKg: 200, canonicalRateUsd: 3 },
    ] as any, 150);
    expect(result.replayRemainingKg).toBe(150);
    expect(result.endingRate).toBe(3);
  });
});

// ── 5. Valuation-basis handling in ADD adjustments ────────────────────────────

describe("replaySupplierTimeline — valuation_basis for ADD adjustments", () => {
  it("QUANTITY_ONLY: adds kg without changing rate", async () => {
    const result = await replaySupplierTimeline(1, 10, "S", 0, [
      { kind: "RECEIPT", effectiveDate: "2025-01-01", createdAt: 1, stableId: 1, receiptKg: 100, canonicalRateUsd: 3 },
      // QUANTITY_ONLY adjustment: adds 20 kg, rate must stay at $3
      { kind: "ADD_ADJUSTMENT", effectiveDate: "2025-02-01", createdAt: 2, stableId: 2, adjustKg: 20, costPerKgUsd: 10, valuationBasis: "QUANTITY_ONLY" },
    ] as any, 120);
    expect(result.endingRate).toBe(3); // rate unchanged
    expect(result.replayRemainingKg).toBe(120);
  });

  it("VALUED_TRANSFER: blends kg and value into moving average", async () => {
    const result = await replaySupplierTimeline(1, 11, "S", 0, [
      { kind: "RECEIPT", effectiveDate: "2025-01-01", createdAt: 1, stableId: 1, receiptKg: 100, canonicalRateUsd: 2 },
      // VALUED_TRANSFER: 50 kg @ $6 blended with 100 kg @ $2
      { kind: "ADD_ADJUSTMENT", effectiveDate: "2025-02-01", createdAt: 2, stableId: 2, adjustKg: 50, costPerKgUsd: 6, valuationBasis: "VALUED_TRANSFER" },
    ] as any, 150);
    // blended = (100*2 + 50*6) / 150 ≈ 3.333
    expect(result.endingRate).toBeCloseTo((100 * 2 + 50 * 6) / 150, 4);
    expect(result.replayRemainingKg).toBe(150);
  });

  it("OPENING_BALANCE: establishes rate when remaining is zero", async () => {
    const result = await replaySupplierTimeline(1, 12, "S", 0, [
      // Opening balance: 200 kg @ $4
      { kind: "ADD_ADJUSTMENT", effectiveDate: "2025-01-01", createdAt: 1, stableId: 1, adjustKg: 200, costPerKgUsd: 4, valuationBasis: "OPENING_BALANCE" },
    ] as any, 200);
    expect(result.endingRate).toBe(4);
    expect(result.replayRemainingKg).toBe(200);
  });

  it("unclassified valued ADD (null valuationBasis): still adds kg (engine-side — supplier marked BLOCKED in preview)", async () => {
    // The engine applies the kg regardless; the preview layer BLOCKS apply for the supplier.
    // The rate must not shift (no valuationBasis = QUANTITY_ONLY fallback).
    const result = await replaySupplierTimeline(1, 13, "S", 0, [
      { kind: "RECEIPT", effectiveDate: "2025-01-01", createdAt: 1, stableId: 1, receiptKg: 100, canonicalRateUsd: 3 },
      { kind: "ADD_ADJUSTMENT", effectiveDate: "2025-02-01", createdAt: 2, stableId: 2, adjustKg: 20, costPerKgUsd: 10 },
    ] as any, 120);
    // Falls through to QUANTITY_ONLY path (no valuationBasis), rate stays at $3
    expect(result.endingRate).toBe(3);
    expect(result.replayRemainingKg).toBe(120);
  });
});

// ── 6. Multi-receipt accumulation: CONTAINER_DIRECT + SUPPLIER path together ──

describe("replaySupplierTimeline — multi-event timeline", () => {
  it("correctly blends three receipts with two consumptions", async () => {
    // Receipt 1: 200 kg @ $2 → remaining 200, rate $2
    // Consumption: 80 kg → remaining 120
    // Receipt 2: 60 kg @ $5 → new rate = (120*2 + 60*5) / 180 = 340/180 ≈ 1.889
    // Consumption: 100 kg → remaining 80
    // Receipt 3: 40 kg @ $8 → new rate = (80*1.889 + 40*8) / 120 = (151.11 + 320) / 120 ≈ 3.926
    const r1rate = 2, r2rate = 5, r3rate = 8;
    const rate_after_r2 = (120 * r1rate + 60 * r2rate) / 180;
    const rate_after_r3 = (80 * rate_after_r2 + 40 * r3rate) / 120;
    const result = await replaySupplierTimeline(1, 20, "S", 0, [
      { kind: "RECEIPT", effectiveDate: "2025-01-01", createdAt: 1, stableId: 1, receiptKg: 200, canonicalRateUsd: r1rate },
      { kind: "BATCH_CONSUMPTION", effectiveDate: "2025-02-01", createdAt: 2, stableId: 2, batchId: 30, consumptionKg: 80 },
      { kind: "RECEIPT", effectiveDate: "2025-03-01", createdAt: 3, stableId: 3, receiptKg: 60, canonicalRateUsd: r2rate },
      { kind: "BATCH_CONSUMPTION", effectiveDate: "2025-04-01", createdAt: 4, stableId: 4, batchId: 31, consumptionKg: 100 },
      { kind: "RECEIPT", effectiveDate: "2025-05-01", createdAt: 5, stableId: 5, receiptKg: 40, canonicalRateUsd: r3rate },
    ] as any, 120);
    expect(result.replayRemainingKg).toBe(120);
    expect(result.endingRate).toBeCloseTo(rate_after_r3, 4);
  });

  it("records expectedRateAtBatch correctly for each consumption", async () => {
    const result = await replaySupplierTimeline(1, 21, "S", 0, [
      { kind: "RECEIPT", effectiveDate: "2025-01-01", createdAt: 1, stableId: 1, receiptKg: 100, canonicalRateUsd: 3 },
      { kind: "BATCH_CONSUMPTION", effectiveDate: "2025-02-01", createdAt: 2, stableId: 2, batchId: 50, consumptionKg: 30 },
      { kind: "RECEIPT", effectiveDate: "2025-03-01", createdAt: 3, stableId: 3, receiptKg: 50, canonicalRateUsd: 7 },
      { kind: "BATCH_CONSUMPTION", effectiveDate: "2025-04-01", createdAt: 4, stableId: 4, batchId: 51, consumptionKg: 20 },
    ] as any, 100);
    // At batch 50: rate still $3 (before any receipt update)
    expect(result.expectedRateAtBatch.get(50)).toBe(3);
    // At batch 51: rate = (70*3 + 50*7) / 120 ≈ 4.667
    const expectedAt51 = (70 * 3 + 50 * 7) / 120;
    expect(result.expectedRateAtBatch.get(51)).toBeCloseTo(expectedAt51, 5);
  });
});

// ── 7. safeToRepair is false when quantity mismatch ───────────────────────────

describe("replaySupplierTimeline — safeToRepair gating", () => {
  it("is safe when replayRemainingKg matches authoritativeRemainingKg within tolerance", async () => {
    const result = await replaySupplierTimeline(1, 30, "S", 2, [
      { kind: "RECEIPT", effectiveDate: "2025-01-01", createdAt: 1, stableId: 1, receiptKg: 100, canonicalRateUsd: 2 },
      { kind: "BATCH_CONSUMPTION", effectiveDate: "2025-02-01", createdAt: 2, stableId: 2, batchId: 60, consumptionKg: 98 },
    ] as any, 2);
    expect(result.safeToRepair).toBe(true);
    expect(result.quantityMismatch).toBe(false);
  });

  it("is NOT safe when replayRemainingKg diverges from authoritative", async () => {
    const result = await replaySupplierTimeline(1, 31, "S", 2, [
      { kind: "RECEIPT", effectiveDate: "2025-01-01", createdAt: 1, stableId: 1, receiptKg: 100, canonicalRateUsd: 2 },
      { kind: "BATCH_CONSUMPTION", effectiveDate: "2025-02-01", createdAt: 2, stableId: 2, batchId: 61, consumptionKg: 50 },
    ] as any, 2); // authoritativeRemainingKg = 2, but replay says 50 remain
    expect(result.safeToRepair).toBe(false);
    expect(result.quantityMismatch).toBe(true);
  });
});

// ── 8. resolveInventorySupplierId — edge cases ────────────────────────────────

describe("resolveInventorySupplierId — edge case priority", () => {
  it("supplierId takes priority over containerSupplierId when both present", () => {
    // In this case sourceBatchId is null and supplierId is set → use supplierId.
    expect(resolveInventorySupplierId({ supplierId: 5, containerId: 10, sourceBatchId: null, containerSupplierId: 99 })).toBe(5);
  });

  it("sourceBatchId beats everything even when supplierId and containerSupplierId are set", () => {
    expect(resolveInventorySupplierId({ sourceBatchId: 7, supplierId: 5, containerId: 10, containerSupplierId: 99 })).toBeNull();
  });
});

// ── 9. Zero-boundary clamp with REMOVE_ADJUSTMENT ────────────────────────────

describe("replaySupplierTimeline — zero-boundary clamp with adjustments", () => {
  it("clamps tiny REMOVE_ADJUSTMENT residual to zero before next receipt", async () => {
    const result = await replaySupplierTimeline(1, 40, "S", 0, [
      { kind: "RECEIPT", effectiveDate: "2025-01-01", createdAt: 1, stableId: 1, receiptKg: 100, canonicalRateUsd: 3 },
      { kind: "REMOVE_ADJUSTMENT", effectiveDate: "2025-01-02", createdAt: 2, stableId: 2, adjustKg: 100.0008 },
      { kind: "RECEIPT", effectiveDate: "2025-01-03", createdAt: 3, stableId: 3, receiptKg: 50, canonicalRateUsd: 7 },
    ] as any, 50);
    // residual is -0.0008 → clamped to 0 → next receipt rate = $7
    expect(result.endingRate).toBe(7);
  });

  it("does NOT clamp REMOVE_ADJUSTMENT residuals above 0.001 kg", async () => {
    const result = await replaySupplierTimeline(1, 41, "S", 0, [
      { kind: "RECEIPT", effectiveDate: "2025-01-01", createdAt: 1, stableId: 1, receiptKg: 100, canonicalRateUsd: 3 },
      { kind: "REMOVE_ADJUSTMENT", effectiveDate: "2025-01-02", createdAt: 2, stableId: 2, adjustKg: 98 },
      { kind: "RECEIPT", effectiveDate: "2025-01-03", createdAt: 3, stableId: 3, receiptKg: 50, canonicalRateUsd: 7 },
    ] as any, 52);
    // 2 kg remaining → blended rate = (2*3 + 50*7) / 52 ≈ 6.846
    expect(result.endingRate).toBeCloseTo((2 * 3 + 50 * 7) / 52, 4);
  });
});
