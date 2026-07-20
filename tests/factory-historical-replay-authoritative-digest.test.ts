import { describe, expect, it } from "vitest";
import {
  computeReplayFingerprint,
  loadReplayAuthoritativeInputDigest,
} from "../server/services/factory/historicalCostReplay";

describe("Historical Replay authoritative digest", () => {
  it("uses only the supplied executor and produces a deterministic digest", async () => {
    const calls: Array<{ sql: string; params?: any[] }> = [];
    const executor: any = {
      query: async (sql: string, params?: any[]) => {
        calls.push({ sql, params });
        return { rows: [{ row_count: "1", row_digest: "abc123" }] };
      },
    };
    const first = await loadReplayAuthoritativeInputDigest(executor, 7);
    const second = await loadReplayAuthoritativeInputDigest(executor, 7);
    expect(first.digest).toBe(second.digest);
    expect(Object.keys(first.counts).length).toBeGreaterThan(10);
    expect(calls.every((call) => call.params?.[0] === 7)).toBe(true);
  });

  it("changes the replay fingerprint when the authoritative digest changes", () => {
    const base: any = {
      summary: {}, supplierRows: [], containerRows: [], sourceRows: [], batchRows: [],
      authoritativeInputDigest: "a", authoritativeInputCounts: {},
    };
    const scope: any = {
      supplierIds: [1], containerIdsToUpdate: [], rawStockIdsToUpdate: [],
      sourceIdsToUpdate: [], batchIdsToUpdate: [], availableBaleIdsToUpdate: [],
      finalizedBaleIdsToUpdate: [], blockedBatches: [],
    };
    const first = computeReplayFingerprint(7, [1], base, {
      includeCompletedBatches: false,
      includeFinalizedBales: false,
    }, scope);
    const second = computeReplayFingerprint(7, [1], {
      ...base,
      authoritativeInputDigest: "b",
    }, {
      includeCompletedBatches: false,
      includeFinalizedBales: false,
    }, scope);
    expect(first).not.toBe(second);
  });
});
