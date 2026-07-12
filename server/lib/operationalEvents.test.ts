import { beforeEach, describe, expect, it, vi } from "vitest";

const loggerMock = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("./logger", () => ({
  logger: loggerMock,
}));

import {
  getOperationalEventSnapshot,
  recordIntegrityEvent,
  recordOperationalEvent,
  resetOperationalEventsForTests,
} from "./operationalEvents";

describe("operational event detection", () => {
  beforeEach(() => {
    resetOperationalEventsForTests();
    vi.clearAllMocks();
  });

  it("counts and exposes safe error, bandwidth and integrity events", () => {
    recordOperationalEvent({
      category: "error",
      code: "HTTP SERVER ERROR",
      severity: "critical",
      message: "HTTP server error detected",
      method: "GET",
      path: "/api/test",
      status: 500,
    });
    recordOperationalEvent({
      category: "bandwidth",
      code: "large_http_response",
      severity: "warning",
      message: "Large HTTP response detected",
      responseBytes: 700_000,
    });
    recordIntegrityEvent("voucher_unbalanced", "Voucher integrity warning");

    const snapshot = getOperationalEventSnapshot();

    expect(snapshot.counts).toEqual({ error: 1, bandwidth: 1, integrity: 1 });
    expect(snapshot.recent).toHaveLength(3);
    expect(snapshot.recent[2].code).toBe("http_server_error");
    expect(loggerMock.error).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledTimes(2);
  });

  it("keeps only the most recent bounded event metadata", () => {
    for (let index = 0; index < 60; index += 1) {
      recordOperationalEvent({
        category: "integrity",
        code: `event-${index}`,
        severity: "warning",
        message: `Integrity event ${index}`,
      });
    }

    const snapshot = getOperationalEventSnapshot();

    expect(snapshot.counts.integrity).toBe(60);
    expect(snapshot.recent).toHaveLength(50);
    expect(snapshot.recent[0].code).toBe("event-59");
    expect(snapshot.recent[49].code).toBe("event-10");
  });

  it("normalizes event identifiers and truncates messages", () => {
    recordOperationalEvent({
      category: "integrity",
      code: "  Voucher Balance Mismatch!!  ",
      severity: "warning",
      message: "x".repeat(500),
    });

    const [event] = getOperationalEventSnapshot().recent;

    expect(event.code).toBe("voucher_balance_mismatch_");
    expect(event.message).toHaveLength(200);
  });
});
