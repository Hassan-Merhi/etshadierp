import { describe, expect, it } from "vitest";
import {
  calculateContainedScreenFeedSize,
  classifyScreenFeedConnection,
  formatScreenFeedDelay,
} from "./screen-feed-viewer-layout";

describe("screen feed viewer layout", () => {
  it("fits a source viewport inside the available viewer without changing aspect ratio", () => {
    expect(calculateContainedScreenFeedSize(1000, 600, 1920, 1080)).toEqual({ width: 1000, height: 563 });
    expect(calculateContainedScreenFeedSize(500, 900, 1080, 1920)).toEqual({ width: 500, height: 889 });
  });

  it("returns an empty size for invalid dimensions", () => {
    expect(calculateContainedScreenFeedSize(0, 600, 1920, 1080)).toEqual({ width: 0, height: 0 });
  });

  it("classifies live, delayed, and stale frames", () => {
    expect(classifyScreenFeedConnection(false, false, 0)).toBe("waiting");
    expect(classifyScreenFeedConnection(true, true, 1200)).toBe("excellent");
    expect(classifyScreenFeedConnection(true, false, 3000)).toBe("good");
    expect(classifyScreenFeedConnection(true, false, 9000)).toBe("delayed");
    expect(classifyScreenFeedConnection(true, true, 20000)).toBe("stale");
  });

  it("formats transport delay for the status bar", () => {
    expect(formatScreenFeedDelay(420)).toBe("420 ms");
    expect(formatScreenFeedDelay(2400)).toBe("2.4 s");
  });
});
