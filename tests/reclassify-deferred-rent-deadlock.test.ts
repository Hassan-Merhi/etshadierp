import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../server/db", () => ({
  pool: {
    query: mocks.query,
  },
}));

vi.mock("../server/lib/logger", () => ({
  logger: {
    info: mocks.info,
    warn: mocks.warn,
    error: mocks.error,
  },
}));

async function loadService() {
  vi.resetModules();
  return import("../server/services/rental/reclassifyDeferredRentService");
}

describe("Properties deferred-rent reclassification deadlock handling", () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.info.mockReset();
    mocks.warn.mockReset();
    mocks.error.mockReset();
  });

  it("retries a rolled-back PostgreSQL deadlock and completes on the next attempt", async () => {
    vi.useFakeTimers();
    try {
      const deadlock = Object.assign(new Error("deadlock detected"), { code: "40P01" });
      mocks.query.mockRejectedValueOnce(deadlock).mockResolvedValueOnce({ rows: [] });

      const { reclassifyLegacyDeferredRentForProperties } = await loadService();
      const result = reclassifyLegacyDeferredRentForProperties("startup");

      await vi.runAllTimersAsync();
      await expect(result).resolves.toBeUndefined();

      expect(mocks.query).toHaveBeenCalledTimes(2);
      expect(mocks.warn).toHaveBeenCalledWith(
        "[RentalIncome] Deadlock during deferred-rent reclassification; retrying",
        expect.objectContaining({
          attempt: 1,
          nextAttempt: 2,
          retryDelayMs: 100,
        })
      );
      expect(mocks.info).toHaveBeenCalledWith(
        "[RentalIncome] Properties deferred-rent reclassification completed",
        expect.objectContaining({ origin: "startup" })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry a non-deadlock database failure", async () => {
    const databaseError = Object.assign(new Error("permission denied"), { code: "42501" });
    mocks.query.mockRejectedValueOnce(databaseError);

    const { reclassifyLegacyDeferredRentForProperties } = await loadService();

    await expect(reclassifyLegacyDeferredRentForProperties("startup")).rejects.toBe(databaseError);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.warn).not.toHaveBeenCalled();
  });
});
