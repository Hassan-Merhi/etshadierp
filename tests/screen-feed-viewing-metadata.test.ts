import { describe, expect, it } from "vitest";
import {
  isValidScreenFeedDataUrl,
  sanitizeScreenFeedCapture,
  sanitizeScreenFeedClicks,
  sanitizeScreenFeedClientCapturedAt,
  sanitizeScreenFeedCursor,
  sanitizeScreenFeedViewport,
} from "../server/services/screenFeedService";

describe("screen feed viewing metadata", () => {
  it("accepts only image data URLs", () => {
    expect(isValidScreenFeedDataUrl("data:image/jpeg;base64,AAAA")).toBe(true);
    expect(isValidScreenFeedDataUrl("data:text/plain;base64,AAAA")).toBe(false);
    expect(isValidScreenFeedDataUrl(null)).toBe(false);
  });

  it("keeps normalized clicks and removes invalid coordinates", () => {
    const now = Date.now();
    expect(
      sanitizeScreenFeedClicks(
        [
          { x: 0.25, y: 0.75, label: "Save", ts: now },
          { x: 2, y: 0.5, label: "invalid", ts: now },
          { x: 0.5, y: Number.NaN, label: "invalid", ts: now },
          { x: 0.5, y: 0.5, label: "stale", ts: now - 9000 },
          { x: 0.5, y: 0.5, label: "invalid", ts: "now" },
        ],
        now
      )
    ).toEqual([{ x: 0.25, y: 0.75, label: "Save", ts: now }]);
    expect(sanitizeScreenFeedClicks(null, now)).toEqual([]);
  });

  it("limits click history and optional labels", () => {
    const now = Date.now();
    const clicks = Array.from({ length: 55 }, (_, index) => ({
      x: 0.5,
      y: 0.5,
      label: index === 54 ? "x".repeat(100) : undefined,
      ts: now - index,
    }));
    const sanitized = sanitizeScreenFeedClicks(clicks, now);

    expect(sanitized).toHaveLength(50);
    expect(sanitized.at(-1)?.label).toHaveLength(60);
    expect(sanitized[0]).not.toHaveProperty("label");
  });

  it("sanitizes fresh cursor updates and defaults visibility", () => {
    const now = Date.now();
    expect(sanitizeScreenFeedCursor({ x: 0.4, y: 0.6, visible: true, ts: now }, now)).toEqual({
      x: 0.4,
      y: 0.6,
      visible: true,
      ts: now,
    });
    expect(sanitizeScreenFeedCursor({ x: 0.4, y: 0.6, ts: now }, now)?.visible).toBe(true);
    expect(sanitizeScreenFeedCursor({ x: 0.4, y: 0.6, visible: false, ts: now }, now)?.visible).toBe(false);
  });

  it("rejects malformed or stale cursor updates", () => {
    const now = Date.now();
    expect(sanitizeScreenFeedCursor(null, now)).toBeNull();
    expect(sanitizeScreenFeedCursor({ x: -1, y: 0.6, ts: now }, now)).toBeNull();
    expect(sanitizeScreenFeedCursor({ x: 0.4, y: 2, ts: now }, now)).toBeNull();
    expect(sanitizeScreenFeedCursor({ x: 0.4, y: 0.6, ts: Number.NaN }, now)).toBeNull();
    expect(sanitizeScreenFeedCursor({ x: 0.4, y: 0.6, ts: now - 31000 }, now)).toBeNull();
  });

  it("bounds viewport metadata", () => {
    expect(
      sanitizeScreenFeedViewport({
        width: 1440,
        height: 900,
        scrollX: 120,
        scrollY: 480,
        documentWidth: 1600,
        documentHeight: 5000,
        devicePixelRatio: 2,
        visualScale: 1.1,
      })
    ).toEqual({
      width: 1440,
      height: 900,
      scrollX: 120,
      scrollY: 480,
      documentWidth: 1600,
      documentHeight: 5000,
      devicePixelRatio: 2,
      visualScale: 1.1,
    });
  });

  it("rejects incomplete and out-of-range viewport metadata", () => {
    const valid = {
      width: 1440,
      height: 900,
      scrollX: 0,
      scrollY: 0,
      documentWidth: 1440,
      documentHeight: 3000,
      devicePixelRatio: 1,
      visualScale: 1,
    };

    expect(sanitizeScreenFeedViewport(null)).toBeUndefined();
    expect(sanitizeScreenFeedViewport({ ...valid, width: 0 })).toBeUndefined();
    expect(sanitizeScreenFeedViewport({ ...valid, height: 25000 })).toBeUndefined();
    expect(sanitizeScreenFeedViewport({ ...valid, scrollX: -1 })).toBeUndefined();
    expect(sanitizeScreenFeedViewport({ ...valid, scrollY: Number.POSITIVE_INFINITY })).toBeUndefined();
    expect(sanitizeScreenFeedViewport({ ...valid, documentWidth: 0 })).toBeUndefined();
    expect(sanitizeScreenFeedViewport({ ...valid, documentHeight: 500000 })).toBeUndefined();
    expect(sanitizeScreenFeedViewport({ ...valid, devicePixelRatio: 10 })).toBeUndefined();
    expect(sanitizeScreenFeedViewport({ ...valid, visualScale: 0.1 })).toBeUndefined();
  });

  it("bounds capture metadata", () => {
    expect(
      sanitizeScreenFeedCapture({
        width: 1440,
        height: 900,
        source: "dom",
        quality: 0.72,
        encodedBytes: 350000,
        durationMs: 420,
      })
    ).toEqual({
      width: 1440,
      height: 900,
      source: "dom",
      quality: 0.72,
      encodedBytes: 350000,
      durationMs: 420,
    });
    expect(
      sanitizeScreenFeedCapture({
        width: 800,
        height: 480,
        source: "fallback",
        quality: 0.5,
        encodedBytes: 50000,
        durationMs: 5,
      })?.source
    ).toBe("fallback");
  });

  it("rejects malformed capture metadata", () => {
    const valid = {
      width: 1440,
      height: 900,
      source: "retry",
      quality: 0.5,
      encodedBytes: 350000,
      durationMs: 420,
    };

    expect(sanitizeScreenFeedCapture(null)).toBeUndefined();
    expect(sanitizeScreenFeedCapture({ ...valid, width: 0 })).toBeUndefined();
    expect(sanitizeScreenFeedCapture({ ...valid, height: 9000 })).toBeUndefined();
    expect(sanitizeScreenFeedCapture({ ...valid, source: "remote" })).toBeUndefined();
    expect(sanitizeScreenFeedCapture({ ...valid, quality: 0.01 })).toBeUndefined();
    expect(sanitizeScreenFeedCapture({ ...valid, encodedBytes: 2000000 })).toBeUndefined();
    expect(sanitizeScreenFeedCapture({ ...valid, durationMs: -1 })).toBeUndefined();
  });

  it("accepts only reasonably clock-aligned client capture times", () => {
    const now = Date.now();
    expect(sanitizeScreenFeedClientCapturedAt(new Date(now - 1000).toISOString(), now)?.getTime()).toBe(now - 1000);
    expect(sanitizeScreenFeedClientCapturedAt(new Date(now - 20 * 60 * 1000).toISOString(), now)).toBeUndefined();
    expect(sanitizeScreenFeedClientCapturedAt("not-a-date", now)).toBeUndefined();
    expect(sanitizeScreenFeedClientCapturedAt(123, now)).toBeUndefined();
  });
});
