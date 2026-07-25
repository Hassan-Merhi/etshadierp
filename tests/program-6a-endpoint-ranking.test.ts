import { describe, expect, it } from "vitest";
import {
  getRequestPerformanceMetrics,
  recordDatabaseQuery,
  runWithRequestPerformanceContext,
} from "../server/lib/requestPerformanceContext";
import { __bandwidthDebugTesting } from "../server/middleware/bandwidthDebug";

const MB = 1024 * 1024;

function aggregate(overrides: Partial<{
  method: string;
  path: string;
  requestCount: number;
  errorCount: number;
  totalResponseBytes: number;
  maxResponseBytes: number;
  totalDurationMs: number;
  maxDurationMs: number;
  totalHeapDeltaBytes: number;
  maxHeapDeltaBytes: number;
  dbQueryCount: number;
  dbDurationMs: number;
}> = {}) {
  return {
    method: "GET",
    path: "/api/test",
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
    ...overrides,
  };
}

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
    const light = __bandwidthDebugTesting.calculateRankScore(aggregate({ path: "/api/health" }));

    const heavy = __bandwidthDebugTesting.calculateRankScore(
      aggregate({
        path: "/api/factory/daybook",
        requestCount: 10,
        totalResponseBytes: 8 * MB,
        maxResponseBytes: MB,
        totalDurationMs: 4_000,
        maxDurationMs: 800,
        totalHeapDeltaBytes: 4 * MB,
        maxHeapDeltaBytes: MB,
        dbQueryCount: 40,
        dbDurationMs: 2_000,
      }),
    );

    expect(heavy).toBeGreaterThan(light);
  });

  it("reports window and endpoint budget violations without changing the ranking data", () => {
    const result = __bandwidthDebugTesting.evaluateBandwidthBudgets(
      [aggregate({ path: "/api/factory/daybook", totalResponseBytes: 30 * MB, maxResponseBytes: 3 * MB })],
      [aggregate({ path: "/assets/index-ABCDEF12.js", totalResponseBytes: 12 * MB, maxResponseBytes: 2 * MB })],
      {
        apiWindowBytes: 25 * MB,
        staticWindowBytes: 10 * MB,
        endpointWindowBytes: 20 * MB,
      },
    );

    expect(result.totalApiResponseBytes).toBe(30 * MB);
    expect(result.totalStaticAssetResponseBytes).toBe(12 * MB);
    expect(result.violations.map((violation) => violation.code)).toEqual([
      "api_bandwidth_budget_exceeded",
      "static_bandwidth_budget_exceeded",
      "api_endpoint_bandwidth_budget_exceeded",
    ]);
    expect(result.violations[2]).toMatchObject({
      method: "GET",
      path: "/api/factory/daybook",
      observedBytes: 30 * MB,
      budgetBytes: 20 * MB,
    });
  });
});
