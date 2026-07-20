import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizePreviewPersistedContainerTotals } from "../server/services/factory/historicalCostReplay";

describe("Historical Replay persisted container targets", () => {
  it("uses rate_per_kg_usd and final_payable_amount_usd instead of raw-stock/reconstructed values", async () => {
    const executor: any = {
      query: async (sql: string, params?: any[]) => {
        expect(sql).toContain("rate_per_kg_usd");
        expect(sql).toContain("final_payable_amount_usd");
        expect(params).toEqual([7, [10]]);
        return {
          rows: [{
            id: 10,
            rate_per_kg_usd: "2.500000",
            final_payable_amount_usd: "2580.000000",
          }],
        };
      },
    };
    const preview: any = {
      summary: { canonicalContainerMismatches: 0 },
      supplierRows: [], sourceRows: [], batchRows: [],
      containerRows: [{
        containerId: 10,
        supplierId: 1,
        storedCostPerKgUsd: 2.25,
        storedTotalUsd: 2450,
        canonicalCostPerKgUsd: 2.5,
        canonicalTotalUsd: 2580,
        safeToRepair: true,
      }],
    };

    const normalized = await normalizePreviewPersistedContainerTotals(executor, 7, preview);
    expect(normalized.containerRows[0].storedCostPerKgUsd).toBe(2.5);
    expect(normalized.containerRows[0].storedTotalUsd).toBe(2580);
    expect(normalized.summary.canonicalContainerMismatches).toBe(0);
  });

  it("detects a persisted container rate mismatch even when raw-stock matched", async () => {
    const executor: any = {
      query: async () => ({
        rows: [{
          id: 10,
          rate_per_kg_usd: "2.250000",
          final_payable_amount_usd: "2580.000000",
        }],
      }),
    };
    const preview: any = {
      summary: { canonicalContainerMismatches: 0 },
      supplierRows: [], sourceRows: [], batchRows: [],
      containerRows: [{
        containerId: 10,
        supplierId: 1,
        storedCostPerKgUsd: 2.5,
        storedTotalUsd: 2580,
        canonicalCostPerKgUsd: 2.5,
        canonicalTotalUsd: 2580,
        safeToRepair: true,
      }],
    };
    const normalized = await normalizePreviewPersistedContainerTotals(executor, 7, preview);
    expect(normalized.summary.canonicalContainerMismatches).toBe(1);
  });

  it("scopes raw-stock mismatches independently from container writes", () => {
    const scopeSource = readFileSync(
      resolve(process.cwd(), "server/services/factory/historical-replay/exactScopeFinal.ts"),
      "utf8"
    );
    const applySource = readFileSync(
      resolve(process.cwd(), "server/services/factory/historical-replay/exactApplyFinal.ts"),
      "utf8"
    );
    expect(scopeSource).toContain("Calculate raw-stock scope independently");
    expect(scopeSource).toContain("base._rawStockIdToContainer = rawStockIdToContainer");
    expect(applySource).toContain("has no approved canonical rate");
    expect(applySource).not.toContain("canonicalRate == null || !approvedContainerIds.has(containerId)");
  });
});
