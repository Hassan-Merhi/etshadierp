import { describe, expect, it } from "vitest";
import { isSafeToQueue } from "../client/src/lib/offlineQueue";

describe("Historical Replay offline safety", () => {
  it("never queues replay prepare, apply, undo or other raw-stock repair requests", () => {
    expect(isSafeToQueue("POST", "/api/factory/raw-stock/recalc/historical-replay/apply")).toBe(false);
    expect(isSafeToQueue("POST", "/api/factory/raw-stock/recalc/undo")).toBe(false);
    expect(isSafeToQueue("POST", "/api/factory/raw-stock/recalc/apply")).toBe(false);
    expect(isSafeToQueue("POST", "/api/factory/raw-stock/recalc/recalculate-used?confirm=true")).toBe(false);
  });

  it("never queues opening-balance bale assignment", () => {
    expect(isSafeToQueue("POST", "/api/factory/raw-stock/123/assign-to-bales")).toBe(false);
  });

  it("does not disturb an existing explicitly safe route", () => {
    expect(isSafeToQueue("POST", "/api/factory/mix-batches")).toBe(true);
  });
});
