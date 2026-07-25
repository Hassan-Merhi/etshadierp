import { describe, expect, it } from "vitest";
import {
  buildContainerOffloadLifecycleScope,
  collectContainerOffloadAdditionalChargeLedgerIds,
  collectContainerOffloadLedgerIds,
  collectContainerOffloadParentAgentIds,
} from "../server/services/containers/containerOffloadLifecyclePolicy";

describe("container offload lifecycle policy", () => {
  it("scopes the lock by company and container", () => {
    expect(buildContainerOffloadLifecycleScope(1, 44)).toEqual({ companyId: 1, containerId: 44 });
    expect(buildContainerOffloadLifecycleScope(2, 44)).not.toEqual(
      buildContainerOffloadLifecycleScope(1, 44)
    );
    expect(buildContainerOffloadLifecycleScope(1, 45)).not.toEqual(
      buildContainerOffloadLifecycleScope(1, 44)
    );
  });

  it("collects only account IDs attached to positive charge amounts", () => {
    expect(
      collectContainerOffloadLedgerIds({
        duties: "100",
        dutiesAccountId: 12,
        officeCharges: "0",
        officeChargesAccountId: 13,
        officeChargesCashAccountId: 14,
        transportFees: "25",
        transportAccountId: 15,
        additionalCharges: [
          { amount: 10, ledgerAccountId: 16 },
          { amount: 0, ledgerAccountId: 17 },
          { amount: 5, ledgerAccountId: 16 },
        ],
      })
    ).toEqual([12, 15, 16]);
  });

  it("isolates additional-charge ledgers for account-type validation", () => {
    expect(
      collectContainerOffloadAdditionalChargeLedgerIds({
        additionalCharges: [
          { amount: 10, ledgerAccountId: 33 },
          { amount: 20, ledgerAccountId: 31 },
          { amount: 0, ledgerAccountId: 32 },
          { amount: 1, ledgerAccountId: 33 },
        ],
      })
    ).toEqual([31, 33]);
  });

  it("collects only funded parent-agent charge ledgers", () => {
    expect(
      collectContainerOffloadParentAgentIds({
        agentChargeLines: [
          { amountUsd: 50, parentAgentAccountId: 101 },
          { amountUsd: 0, parentAgentAccountId: 102 },
          { amountUsd: 25, parentAgentAccountId: 101 },
        ],
      })
    ).toEqual([101]);
  });
});
