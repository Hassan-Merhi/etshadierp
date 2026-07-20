import { describe, expect, it } from "vitest";
import {
  getRequestPerformanceMetrics,
  recordDatabaseQuery,
  runWithRequestPerformanceContext,
} from "../server/lib/requestPerformanceContext";
import { __bandwidthDebugTesting } from "../server/middleware/bandwidthDebug";

describe("Program 6A endpoint ranking", () => {
  it("keeps database cost isolated to the active request context", async () => {
    expect(getRequestPerformanceMetrics()).toEqual({ dbQueryCount: 0, dbDurationMs: 0 });

    await runWithRequestPerformanceContext(async () => {
      recordDatabaseQuery(12.5);
      await Promise.resolve();
      recordDatabaseQuery(7.5);

      expect(getRequestPerformanceMetrics()).toEqual({
        dbQueryCount: 2,
        dbDurationMs: 20,
      });
    });

    expect(getRequestPerformanceMetrics()).toEqual({ dbQueryCount: 0, dbDurationMs: 0 });
  });

  it("ranks a high-bandwidth, slow, database-heavy endpoint above a light endpoint", () => {
    const light = __bandwidthDebugTesting.calculateRankScore({
      method: "GET",
      path: "/api/health",
      requestCount: 1,
      errorCount: 0,
      totalResponseBytes: 200,
      maxResponseBytes: 200,
      totalDurationMs: 5,
      maxDurationMs: 5,
      totalHeapDeltaBytes: 0,
      maxHeapDeltaBytes: 0,
      dbQueryCount: 0,
      dbDurationMs: 0,
    });

    const heavy = __bandwidthDebugTesting.calculateRankScore({
      method: "GET",
      path: "/api/factory/daybook",
      requestCount: 10,
      errorCount: 0,
      totalResponseBytes: 8 * 1024 * 1024,
      maxResponseBytes: 1024 * 1024,
      totalDurationMs: 4_000,
      maxDurationMs: 800,
      totalHeapDeltaBytes: 4 * 1024 * 1024,
      maxHeapDeltaBytes: 1024 * 1024,
      dbQueryCount: 40,
      dbDurationMs: 2_000,
    });

    expect(heavy).toBeGreaterThan(light);
  });
});
