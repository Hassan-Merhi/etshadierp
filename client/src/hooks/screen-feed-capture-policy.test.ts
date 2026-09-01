import { describe, expect, it } from "vitest";
import {
  ACTIVE_CAPTURE_DELAY_MS,
  CAPTURE_DUTY_CYCLE,
  FAILED_CAPTURE_DELAY_MS,
  IDLE_CAPTURE_DELAY_MS,
  MAX_ADAPTIVE_CAPTURE_GAP_MS,
  MAX_FAILED_CAPTURE_BACKOFF_MS,
  MAX_IDLE_CAPTURE_DELAY_MS,
  adaptiveCaptureGapMs,
  failedCaptureBackoffMs,
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

  it("uploads a frame whose pixels could not be read rather than dropping it", () => {
    // An unreadable canvas (tainted, so getImageData throws) yields no
    // signature. Without the force flag the frame compares equal to the empty
    // baseline and is silently discarded, leaving the watcher with no picture.
    expect(
      shouldUploadScreenFrame({
        signature: "",
        lastSignature: "",
        latestClickTs: 0,
        lastUploadedClickTs: 0,
        force: true,
      })
    ).toBe(true);
  });

  it("spaces captures by what the previous render actually cost", () => {
    expect(adaptiveCaptureGapMs(ACTIVE_CAPTURE_DELAY_MS, 0)).toBe(ACTIVE_CAPTURE_DELAY_MS);
    expect(adaptiveCaptureGapMs(ACTIVE_CAPTURE_DELAY_MS, 50)).toBe(ACTIVE_CAPTURE_DELAY_MS);
    expect(adaptiveCaptureGapMs(ACTIVE_CAPTURE_DELAY_MS, 900)).toBe(900 * CAPTURE_DUTY_CYCLE);
    expect(adaptiveCaptureGapMs(ACTIVE_CAPTURE_DELAY_MS, 60_000)).toBe(MAX_ADAPTIVE_CAPTURE_GAP_MS);
  });

  it("widens the retry gap while captures keep failing", () => {
    expect(failedCaptureBackoffMs(1)).toBe(FAILED_CAPTURE_DELAY_MS);
    expect(failedCaptureBackoffMs(3)).toBeGreaterThan(failedCaptureBackoffMs(1));
    expect(failedCaptureBackoffMs(50)).toBeLessThanOrEqual(MAX_FAILED_CAPTURE_BACKOFF_MS);
    // The gap plateaus instead of growing without bound.
    expect(failedCaptureBackoffMs(50)).toBe(failedCaptureBackoffMs(5));
  });

  it("produces stable signatures from sampled pixels", () => {
    const pixels = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    expect(hashScreenFeedPixels(pixels)).toBe(hashScreenFeedPixels(pixels));
    expect(hashScreenFeedPixels(pixels)).not.toBe(
      hashScreenFeedPixels(new Uint8ClampedArray([10, 20, 31, 255, 40, 50, 60, 255]))
    );
  });
});
