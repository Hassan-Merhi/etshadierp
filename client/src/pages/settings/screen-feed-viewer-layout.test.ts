import { describe, expect, it } from "vitest";
import {
  calculateContainedScreenFeedSize,
  classifyScreenFeedConnection,
  formatScreenFeedDelay,
} from "./screen-feed-viewer-layout";

describe("screen feed viewer layout", () => {
  it("fits a landscape source viewport inside the available viewer without changing aspect ratio", () => {
    expect(calculateContainedScreenFeedSize(1000, 600, 1920, 1080)).toEqual({ width: 1000, height: 563 });
  });

  it("fits a portrait source viewport inside the available viewer without stretching", () => {
    expect(calculateContainedScreenFeedSize(500, 900, 1080, 1920)).toEqual({ width: 500, height: 889 });
  });

  it("never enlarges one dimension past the available viewer", () => {
    const size = calculateContainedScreenFeedSize(640, 360, 1707, 860);
    expect(size.width).toBeLessThanOrEqual(640);
    expect(size.height).toBeLessThanOrEqual(360);
    expect(size).toEqual({ width: 640, height: 322 });
  });

  it("returns an empty size for invalid source or container dimensions", () => {
    expect(calculateContainedScreenFeedSize(0, 600, 1920, 1080)).toEqual({ width: 0, height: 0 });
    expect(calculateContainedScreenFeedSize(1000, 600, 0, 1080)).toEqual({ width: 0, height: 0 });
    expect(calculateContainedScreenFeedSize(1000, -1, 1920, 1080)).toEqual({ width: 0, height: 0 });
  });

  it("classifies the exact connection-quality boundaries", () => {
    expect(classifyScreenFeedConnection(false, false, 0)).toBe("waiting");
    expect(classifyScreenFeedConnection(true, true, 2499)).toBe("excellent");
    expect(classifyScreenFeedConnection(true, true, 2500)).toBe("good");
    expect(classifyScreenFeedConnection(true, false, 5999)).toBe("good");
    expect(classifyScreenFeedConnection(true, false, 6000)).toBe("delayed");
    expect(classifyScreenFeedConnection(true, false, 14999)).toBe("delayed");
    expect(classifyScreenFeedConnection(true, true, 15000)).toBe("stale");
  });

  it("does not call an old frame excellent merely because the live transport is connected", () => {
    expect(classifyScreenFeedConnection(true, true, 20000)).toBe("stale");
  });

  it("formats transport and render delay consistently", () => {
    expect(formatScreenFeedDelay(420)).toBe("420 ms");
    expect(formatScreenFeedDelay(2400)).toBe("2.4 s");
    expect(formatScreenFeedDelay(9999)).toBe("10.0 s");
    expect(formatScreenFeedDelay(10000)).toBe("10 s");
    expect(formatScreenFeedDelay(Number.NaN)).toBe("—");
    expect(formatScreenFeedDelay(-1)).toBe("—");
  });
});
