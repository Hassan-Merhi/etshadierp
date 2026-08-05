import { describe, expect, it } from "vitest";
import {
  approximateDataUrlBytes,
  extractScreenFeedCssUrls,
  getScreenFeedCaptureScale,
  isSafeScreenFeedAssetUrl,
  normalizeScreenFeedPoint,
  shouldPreserveScreenFeedBackground,
} from "./screen-feed-viewing-quality";

describe("screen feed viewing quality helpers", () => {
  it("normalizes and clamps pointer coordinates", () => {
    expect(normalizeScreenFeedPoint(500, 250, 1000, 500)).toEqual({ x: 0.5, y: 0.5 });
    expect(normalizeScreenFeedPoint(-20, 900, 1000, 500)).toEqual({ x: 0, y: 1 });
  });

  // Capture is pinned to viewport resolution rather than tracking devicePixelRatio. The old 1.25x
  // upscale at DPR 2 sent 25% more pixels on ordinary Windows display scaling for detail remote
  // support does not need, so the implementation now clamps every ratio to 1. Guard that it stays
  // clamped — including for hostile input — rather than re-asserting the upscale it replaced.
  it("pins capture scale to viewport resolution for every device pixel ratio", () => {
    expect(getScreenFeedCaptureScale(0.5)).toBe(1);
    expect(getScreenFeedCaptureScale(1)).toBe(1);
    expect(getScreenFeedCaptureScale(2)).toBe(1);
    expect(getScreenFeedCaptureScale(3)).toBe(1);
    expect(getScreenFeedCaptureScale(0)).toBe(1);
    expect(getScreenFeedCaptureScale(-1)).toBe(1);
    expect(getScreenFeedCaptureScale(Number.NaN)).toBe(1);
  });

  it("allows same-origin and in-memory assets while rejecting remote assets", () => {
    const origin = "https://erp.example.com";
    expect(isSafeScreenFeedAssetUrl("/assets/logo.png", origin)).toBe(true);
    expect(isSafeScreenFeedAssetUrl("data:image/png;base64,abc", origin)).toBe(true);
    expect(isSafeScreenFeedAssetUrl("blob:https://erp.example.com/id", origin)).toBe(true);
    expect(isSafeScreenFeedAssetUrl("https://other.example.com/logo.png", origin)).toBe(false);
  });

  it("extracts and validates every CSS background URL", () => {
    const origin = "https://erp.example.com";
    expect(extractScreenFeedCssUrls('linear-gradient(#fff,#000), url("/assets/grid.png")')).toEqual([
      "/assets/grid.png",
    ]);
    expect(shouldPreserveScreenFeedBackground('url("/assets/grid.png")', origin)).toBe(true);
    expect(shouldPreserveScreenFeedBackground('url("https://other.example.com/grid.png")', origin)).toBe(false);
  });

  it("estimates decoded payload bytes from a base64 data URL", () => {
    expect(approximateDataUrlBytes("data:image/jpeg;base64,AAAA")).toBe(3);
  });
});
