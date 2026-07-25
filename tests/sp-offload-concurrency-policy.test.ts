import { describe, expect, it } from "vitest";
import {
  buildSpOffloadLockScope,
  classifySpOffloadState,
} from "../server/routes/sp/spOffloadConcurrencyGuard";

describe("SP offload concurrency policy", () => {
  it("scopes the advisory lock to company and container", () => {
    expect(buildSpOffloadLockScope(2, 44)).toEqual({ companyId: 2, containerId: 44 });
    expect(buildSpOffloadLockScope(3, 44)).not.toEqual(buildSpOffloadLockScope(2, 44));
    expect(buildSpOffloadLockScope(2, 45)).not.toEqual(buildSpOffloadLockScope(2, 44));
  });

  it("posts only an open container", () => {
    expect(classifySpOffloadState("open", false)).toBe("post");
    expect(classifySpOffloadState("open", true)).toBe("post");
  });

  it("returns an existing offload as an idempotent replay", () => {
    expect(classifySpOffloadState("offloaded", true)).toBe("replay");
    expect(classifySpOffloadState("closed", true)).toBe("replay");
  });

  it("rejects a non-open container without an offload record", () => {
    expect(classifySpOffloadState("offloaded", false)).toBe("reject");
    expect(classifySpOffloadState(null, false)).toBe("reject");
  });
});
