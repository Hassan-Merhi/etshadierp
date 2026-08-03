import { describe, expect, it } from "vitest";
import {
  sanitizeScreenFeedCapture,
  sanitizeScreenFeedClicks,
  sanitizeScreenFeedClientCapturedAt,
  sanitizeScreenFeedCursor,
  sanitizeScreenFeedViewport,
} from "../server/services/screenFeedService";

describe("screen feed viewing metadata", () => {
  it("keeps normalized clicks and removes invalid coordinates", () => {
    const now = Date.now();
    expect(
      sanitizeScreenFeedClicks(
        [
          { x: 0.25, y: 0.75, label: "Save", ts: now },
          { x: 2, y: 0.5, label: "invalid", ts: now },
        ],
        now,
      ),
    ).toEqual([{ x: 0.25, y: 0.75, label: "Save", ts: now }]);
  });

  it("sanitizes fresh cursor updates", () => {
    const now = Date.now();
    expect(sanitizeScreenFeedCursor({ x: 0.4, y: 0.6, visible: true, ts: now }, now)).toEqual({
      x: 0.4,
      y: 0.6,
      visible: true,
      ts: now,
    });
    expect(sanitizeScreenFeedCursor({ x: -1, y: 0.6, visible: true, ts: now }, now)).toBeNull();
  });

  it("bounds viewport and capture metadata", () => {
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
      }),
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

    expect(
      sanitizeScreenFeedCapture({
        width: 1440,
        height: 900,
        source: "dom",
        quality: 0.72,
        encodedBytes: 350000,
        durationMs: 420,
      }),
    ).toEqual({
      width: 1440,
      height: 900,
      source: "dom",
      quality: 0.72,
      encodedBytes: 350000,
      durationMs: 420,
    });
  });

  it("accepts only reasonably clock-aligned client capture times", () => {
    const now = Date.now();
    expect(sanitizeScreenFeedClientCapturedAt(new Date(now - 1000).toISOString(), now)?.getTime()).toBe(now - 1000);
    expect(sanitizeScreenFeedClientCapturedAt(new Date(now - 20 * 60 * 1000).toISOString(), now)).toBeUndefined();
  });
});
