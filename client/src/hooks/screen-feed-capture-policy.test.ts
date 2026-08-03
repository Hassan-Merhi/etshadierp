import { describe, expect, it } from "vitest";
import {
  ACTIVE_CAPTURE_DELAY_MS,
  FAILED_CAPTURE_DELAY_MS,
  IDLE_CAPTURE_DELAY_MS,
  MAX_IDLE_CAPTURE_DELAY_MS,
  hashScreenFeedPixels,
  nextScreenFeedCaptureDelay,
  shouldUploadScreenFrame,
} from "./screen-feed-capture-policy";

describe("screen feed capture policy", () => {
  it("uploads visual changes and new clicks but skips identical idle frames", () => {
    expect(
      shouldUploadScreenFrame({
        signature: "new",
        lastSignature: "old",
        latestClickTs: 0,
        lastUploadedClickTs: 0,
      })
    ).toBe(true);
    expect(
      shouldUploadScreenFrame({
        signature: "same",
        lastSignature: "same",
        latestClickTs: 20,
        lastUploadedClickTs: 10,
      })
    ).toBe(true);
    expect(
      shouldUploadScreenFrame({
        signature: "same",
        lastSignature: "same",
        latestClickTs: 10,
        lastUploadedClickTs: 10,
      })
    ).toBe(false);
  });

  it("slows down progressively while the screen is unchanged", () => {
    expect(nextScreenFeedCaptureDelay(0)).toBe(ACTIVE_CAPTURE_DELAY_MS);
    expect(nextScreenFeedCaptureDelay(2)).toBe(IDLE_CAPTURE_DELAY_MS);
    expect(nextScreenFeedCaptureDelay(4)).toBe(MAX_IDLE_CAPTURE_DELAY_MS);
    expect(nextScreenFeedCaptureDelay(0, true)).toBe(FAILED_CAPTURE_DELAY_MS);
  });

  it("produces stable signatures from sampled pixels", () => {
    const pixels = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    expect(hashScreenFeedPixels(pixels)).toBe(hashScreenFeedPixels(pixels));
    expect(hashScreenFeedPixels(pixels)).not.toBe(
      hashScreenFeedPixels(new Uint8ClampedArray([10, 20, 31, 255, 40, 50, 60, 255]))
    );
  });
});
