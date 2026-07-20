import { beforeEach, describe, expect, it } from "vitest";
import {
  HISTORICAL_REPLAY_APPLY_PATH,
  clearHistoricalReplayPreparations,
  freezeHistoricalReplayApplyRequest,
  rememberHistoricalReplayPreparation,
} from "../client/src/lib/historicalReplayPreparedRequest";

describe("Historical Replay prepared client requests", () => {
  beforeEach(() => clearHistoricalReplayPreparations());

  it("uses server-returned supplier IDs and options instead of live UI values", () => {
    expect(rememberHistoricalReplayPreparation({
      confirmationToken: "signed",
      safeSupplierIds: [2, 1],
      frozenOptions: {
        includeCompletedBatches: true,
        includeFinalizedBales: false,
      },
      algorithmVersion: "v6-final-static-safety",
      fingerprint: "fp",
    })).toBe(true);

    expect(freezeHistoricalReplayApplyRequest("POST", HISTORICAL_REPLAY_APPLY_PATH, {
      confirmationToken: "signed",
      supplierIds: [999],
      includeCompletedBatches: false,
      includeFinalizedBales: true,
    })).toEqual({
      dryRun: false,
      confirmationToken: "signed",
      supplierIds: [1, 2],
      includeCompletedBatches: true,
      includeFinalizedBales: false,
      algorithmVersion: "v6-final-static-safety",
      fingerprint: "fp",
    });
  });

  it("sends only the signed token when prepared memory is unavailable", () => {
    expect(freezeHistoricalReplayApplyRequest("POST", HISTORICAL_REPLAY_APPLY_PATH, {
      confirmationToken: "signed-after-reload",
      supplierIds: [999],
    })).toEqual({
      dryRun: false,
      confirmationToken: "signed-after-reload",
    });
  });
});
