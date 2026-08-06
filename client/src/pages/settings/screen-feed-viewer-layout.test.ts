import { describe, expect, it } from "vitest";
import {
  calculateContainedScreenFeedSize,
  classifyScreenFeedConnection,
  decideScreenFeedRecovery,
  formatScreenFeedDelay,
  getScreenFeedRecoveryDelay,
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

  it("uses bounded exponential recovery delays", () => {
    const attempts = [0, 1, 2, 3, 4, 5, 99];
    const delays = attempts.map(getScreenFeedRecoveryDelay);

    expect(delays).toEqual([1000, 2000, 4000, 8000, 15000, 15000, 15000]);
    expect(getScreenFeedRecoveryDelay(Number.NaN)).toBe(1000);
    expect(getScreenFeedRecoveryDelay(-5)).toBe(1000);
  });

  it("reconnects while waiting for the first frame when transport is unavailable", () => {
    const decision = decideScreenFeedRecovery({
      hasFrame: false,
      liveConnected: false,
      frameAgeMs: Number.POSITIVE_INFINITY,
      recoveryAttempt: 2,
    });

    expect(decision).toEqual({
      quality: "waiting",
      action: "reconnect",
      retryAfterMs: 4000,
      reason: "waiting-for-first-frame",
    });
  });

  it("polls for the first frame when the transport is connected", () => {
    const decision = decideScreenFeedRecovery({
      hasFrame: false,
      liveConnected: true,
      frameAgeMs: Number.POSITIVE_INFINITY,
      recoveryAttempt: 0,
    });

    expect(decision).toMatchObject({
      quality: "waiting",
      action: "poll",
      retryAfterMs: 1000,
    });
  });

  it("polls delayed connected feeds but reconnects disconnected or stale feeds", () => {
    const delayed = decideScreenFeedRecovery({
      hasFrame: true,
      liveConnected: true,
      frameAgeMs: 7000,
      recoveryAttempt: 1,
    });
    const disconnected = decideScreenFeedRecovery({
      hasFrame: true,
      liveConnected: false,
      frameAgeMs: 7000,
      recoveryAttempt: 1,
    });
    const stale = decideScreenFeedRecovery({
      hasFrame: true,
      liveConnected: true,
      frameAgeMs: 16000,
      recoveryAttempt: 1,
    });

    expect(delayed).toMatchObject({
      quality: "delayed",
      action: "poll",
      reason: "frame-delayed",
    });
    expect(disconnected).toMatchObject({
      quality: "delayed",
      action: "reconnect",
      reason: "transport-disconnected",
    });
    expect(stale).toMatchObject({
      quality: "stale",
      action: "reconnect",
      reason: "frame-stale",
    });
  });

  it("does not schedule recovery for a healthy feed", () => {
    const decision = decideScreenFeedRecovery({
      hasFrame: true,
      liveConnected: true,
      frameAgeMs: 1200,
      recoveryAttempt: 4,
    });

    expect(decision).toEqual({
      quality: "excellent",
      action: "none",
      retryAfterMs: null,
      reason: "healthy",
    });
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
