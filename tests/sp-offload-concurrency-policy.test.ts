import { describe, expect, it } from "vitest";
import {
  buildSpOffloadLockScope,
  classifySpOffloadState,
  isCompatibleSpOffloadReplay,
} from "../server/services/sp/spOffloadConcurrencyPolicy";

describe("SP offload concurrency policy", () => {
  it("scopes the advisory lock to company and container", () => {
    expect(buildSpOffloadLockScope(2, 44)).toEqual({ companyId: 2, containerId: 44 });
    expect(buildSpOffloadLockScope(3, 44)).not.toEqual(buildSpOffloadLockScope(2, 44));
    expect(buildSpOffloadLockScope(2, 45)).not.toEqual(buildSpOffloadLockScope(2, 44));
  });

  it("posts only an open container without an existing offload", () => {
    expect(classifySpOffloadState("open", false, false)).toBe("post");
  });

  it("accepts only a compatible completed offload as replay", () => {
    const existing = { offloadDate: "2026-07-25", locationId: 8, totalLandedCostUsd: 1250 };
    expect(isCompatibleSpOffloadReplay(existing, { ...existing, totalLandedCostUsd: 1250.004 })).toBe(true);
    expect(classifySpOffloadState("offloaded", true, true)).toBe("replay");
    expect(classifySpOffloadState("open", true, true)).toBe("replay");
  });

  it("rejects an incompatible retry instead of hiding a changed request", () => {
    const existing = { offloadDate: "2026-07-25", locationId: 8, totalLandedCostUsd: 1250 };
    expect(isCompatibleSpOffloadReplay(existing, { ...existing, locationId: 9 })).toBe(false);
    expect(isCompatibleSpOffloadReplay(existing, { ...existing, offloadDate: "2026-07-26" })).toBe(false);
    expect(isCompatibleSpOffloadReplay(existing, { ...existing, totalLandedCostUsd: 1250.01 })).toBe(false);
    expect(classifySpOffloadState("offloaded", true, false)).toBe("conflict");
  });

  it("rejects a non-open container without an offload record", () => {
    expect(classifySpOffloadState("offloaded", false, false)).toBe("reject");
    expect(classifySpOffloadState(null, false, false)).toBe("reject");
  });
});
