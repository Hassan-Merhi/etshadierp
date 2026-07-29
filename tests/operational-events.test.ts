/**
 * Unit tests for server/lib/operationalEvents.ts — the in-memory operational
 * event recorder (category/severity/code counters + a bounded recent-events
 * ring buffer). Covers input normalisation, newest-first ordering, the 50-item
 * cap, snapshot immutability, rollups, and severity → logger routing.
 */
import { vi } from "vitest";

const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }));
vi.mock("../server/lib/logger", () => ({ logger }));

import {
  recordOperationalEvent,
  recordIntegrityEvent,
  getOperationalEventSnapshot,
  resetOperationalEventsForTests,
} from "../server/lib/operationalEvents";

beforeEach(() => {
  resetOperationalEventsForTests();
  logger.error.mockClear();
  logger.warn.mockClear();
  logger.info.mockClear();
});

describe("recordOperationalEvent", () => {
  it("increments category, severity, and code rollups", () => {
    recordOperationalEvent({ category: "error", code: "HTTP Failure", severity: "warning", message: "first" });
    recordOperationalEvent({ category: "error", code: "HTTP Failure", severity: "critical", message: "latest" });
    recordOperationalEvent({ category: "bandwidth", code: "large_response", severity: "info", message: "m" });
    const snap = getOperationalEventSnapshot();

    expect(snap.counts).toEqual({ error: 2, bandwidth: 1, integrity: 0 });
    expect(snap.severityCounts).toEqual({ info: 1, warning: 1, critical: 1 });
    expect(snap.byCode[0]).toMatchObject({
      code: "http_failure",
      category: "error",
      severity: "critical",
      count: 2,
      lastMessage: "latest",
    });
  });

  it("stores events newest-first", () => {
    recordOperationalEvent({ category: "error", code: "first", severity: "info", message: "m" });
    recordOperationalEvent({ category: "error", code: "second", severity: "info", message: "m" });
    expect(getOperationalEventSnapshot().recent[0].code).toBe("second");
  });

  it("normalises the code (lowercase, safe charset, fallback)", () => {
    recordOperationalEvent({ category: "error", code: "  My Code!! ", severity: "info", message: "m" });
    expect(getOperationalEventSnapshot().recent[0].code).toBe("my_code_");

    recordOperationalEvent({ category: "error", code: "   ", severity: "info", message: "m" });
    expect(getOperationalEventSnapshot().recent[0].code).toBe("unknown_event");
  });

  it("truncates an over-long code to 80 chars", () => {
    recordOperationalEvent({ category: "error", code: "a".repeat(200), severity: "info", message: "m" });
    expect(getOperationalEventSnapshot().recent[0].code).toHaveLength(80);
  });

  it("normalises the message (fallback + 200-char cap)", () => {
    recordOperationalEvent({ category: "error", code: "c", severity: "info", message: "   " });
    expect(getOperationalEventSnapshot().recent[0].message).toBe("Operational event detected");

    recordOperationalEvent({ category: "error", code: "c", severity: "info", message: "z".repeat(500) });
    expect(getOperationalEventSnapshot().recent[0].message).toHaveLength(200);
  });

  it("caps the recent-events buffer at 50", () => {
    for (let i = 0; i < 60; i++) {
      recordOperationalEvent({ category: "error", code: `c${i}`, severity: "info", message: "m" });
    }
    const snap = getOperationalEventSnapshot();
    expect(snap.recent).toHaveLength(50);
    expect(snap.counts.error).toBe(60);
    expect(snap.recent[0].code).toBe("c59");
  });

  it("routes critical severity to logger.error, warning to logger.warn, and info to logger.info", () => {
    recordOperationalEvent({ category: "error", code: "c", severity: "critical", message: "bad" });
    expect(logger.error).toHaveBeenCalledTimes(1);

    recordOperationalEvent({ category: "error", code: "c", severity: "warning", message: "meh" });
    expect(logger.warn).toHaveBeenCalledTimes(1);

    recordOperationalEvent({ category: "error", code: "c", severity: "info", message: "ok" });
    expect(logger.info).toHaveBeenCalledTimes(1);
  });
});

describe("recordIntegrityEvent", () => {
  it("records under the integrity category", () => {
    recordIntegrityEvent("bale_mismatch", "counts disagree");
    const snap = getOperationalEventSnapshot();
    expect(snap.counts.integrity).toBe(1);
    expect(snap.recent[0].category).toBe("integrity");
    expect(snap.recent[0].code).toBe("bale_mismatch");
  });
});

describe("getOperationalEventSnapshot", () => {
  it("returns copies — mutating the snapshot does not affect internal state", () => {
    recordOperationalEvent({ category: "error", code: "c", severity: "info", message: "m" });
    const snap = getOperationalEventSnapshot();
    snap.recent.push({ category: "error" } as never);
    snap.byCode[0].count = 999;
    snap.counts.error = 999;
    const fresh = getOperationalEventSnapshot();
    expect(fresh.recent).toHaveLength(1);
    expect(fresh.byCode[0].count).toBe(1);
    expect(fresh.counts.error).toBe(1);
  });
});
