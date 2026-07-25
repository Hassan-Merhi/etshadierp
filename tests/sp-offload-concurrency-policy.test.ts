import { describe, expect, it } from "vitest";
import {
  buildSpOffloadChargeSignature,
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

  it("normalizes charge order and parent-agent persistence shape", () => {
    const requested = buildSpOffloadChargeSignature([
      { chargeType: "paid_now", description: "Port", amountUsd: 250, creditBankAccountId: 7 },
      { chargeType: "parent_agent", description: "Agent", amountUsd: 100, parentAgentAccountId: 91 },
    ]);
    const persisted = buildSpOffloadChargeSignature([
      { chargeType: "parent_agent", description: "Agent", amountUsd: "100.0000", creditLedgerAccountId: 91 },
      { chargeType: "paid_now", description: "Port", amountUsd: "250.0000", creditBankAccountId: 7 },
    ]);
    expect(requested).toBe(persisted);
  });

  it("posts only an open container without an existing offload", () => {
    expect(classifySpOffloadState("open", false, false)).toBe("post");
  });

  it("accepts only a compatible completed offload as replay", () => {
    const chargeSignature = buildSpOffloadChargeSignature([
      { chargeType: "paid_now", amountUsd: 1250, creditBankAccountId: 8 },
    ]);
    const existing = {
      offloadDate: "2026-07-25",
      locationId: 8,
      totalLandedCostUsd: 1250,
      chargeSignature,
    };
    expect(
      isCompatibleSpOffloadReplay(existing, {
        ...existing,
        totalLandedCostUsd: 1250.004,
      })
    ).toBe(true);
    expect(classifySpOffloadState("offloaded", true, true)).toBe("replay");
    expect(classifySpOffloadState("open", true, true)).toBe("replay");
  });

  it("rejects changed date, location, total, or charge account allocation", () => {
    const existing = {
      offloadDate: "2026-07-25",
      locationId: 8,
      totalLandedCostUsd: 1250,
      chargeSignature: buildSpOffloadChargeSignature([
        { chargeType: "paid_now", amountUsd: 1250, creditBankAccountId: 8 },
      ]),
    };
    expect(isCompatibleSpOffloadReplay(existing, { ...existing, locationId: 9 })).toBe(false);
    expect(isCompatibleSpOffloadReplay(existing, { ...existing, offloadDate: "2026-07-26" })).toBe(false);
    expect(isCompatibleSpOffloadReplay(existing, { ...existing, totalLandedCostUsd: 1250.01 })).toBe(false);
    expect(
      isCompatibleSpOffloadReplay(existing, {
        ...existing,
        chargeSignature: buildSpOffloadChargeSignature([
          { chargeType: "paid_now", amountUsd: 1250, creditBankAccountId: 9 },
        ]),
      })
    ).toBe(false);
    expect(classifySpOffloadState("offloaded", true, false)).toBe("conflict");
  });

  it("rejects a non-open container without an offload record", () => {
    expect(classifySpOffloadState("offloaded", false, false)).toBe("reject");
    expect(classifySpOffloadState(null, false, false)).toBe("reject");
  });
});
