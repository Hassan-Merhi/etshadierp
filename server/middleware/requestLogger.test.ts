import { beforeEach, describe, expect, it, vi } from "vitest";

const poolState = {
  options: { max: 10 },
  totalCount: 6,
  idleCount: 2,
  waitingCount: 0,
};

vi.mock("../db", () => ({
  pool: poolState,
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { getRequestMetricsSnapshot } from "./requestLogger";

describe("requestLogger health metrics", () => {
  beforeEach(() => {
    poolState.options.max = 10;
    poolState.totalCount = 6;
    poolState.idleCount = 2;
    poolState.waitingCount = 0;
  });

  it("reports safe process, request baseline, and pool metrics without connection details", () => {
    const snapshot = getRequestMetricsSnapshot();

    expect(snapshot.status).toBe("ok");
    expect(snapshot.databasePool).toEqual({
      max: 10,
      total: 6,
      idle: 2,
      active: 4,
      waiting: 0,
      utilizationPercent: 40,
    });
    expect(snapshot.requests).toMatchObject({
      total: 0,
      active: 0,
      completed: 0,
      success: 0,
      clientError: 0,
      serverError: 0,
      slow: 0,
      averageDurationMs: 0,
      maxDurationMs: 0,
      slowPercent: 0,
      serverErrorPercent: 0,
      slowRequestThresholdMs: 500,
    });
    expect(snapshot.requests.durationBuckets).toEqual({
      under100: 0,
      under500: 0,
      under1000: 0,
      under5000: 0,
      over5000: 0,
    });
    expect(snapshot.process.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(snapshot.process.memoryMb.rss).toBeGreaterThan(0);
    expect(snapshot).not.toHaveProperty("connectionString");
    expect(JSON.stringify(snapshot)).not.toContain("DATABASE_URL");
  });

  it("marks the snapshot degraded when requests are waiting for a pool connection", () => {
    poolState.waitingCount = 3;

    const snapshot = getRequestMetricsSnapshot();

    expect(snapshot.status).toBe("degraded");
    expect(snapshot.databasePool.waiting).toBe(3);
  });
});
