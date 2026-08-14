import { describe, expect, it } from "vitest";

import {
  HISTORICAL_REPLAY_CONFIRM_PHRASE,
  isHistoricalReplayConfirmed,
} from "../client/src/pages/factory/production-raw-stock/rawstockrecalculate/replayConfirmation";

describe("Historical Replay typed confirmation", () => {
  it("requires the exact phrase before the UI can submit apply", () => {
    expect(isHistoricalReplayConfirmed(HISTORICAL_REPLAY_CONFIRM_PHRASE)).toBe(true);
    expect(isHistoricalReplayConfirmed("apply historical replay")).toBe(false);
    expect(isHistoricalReplayConfirmed("APPLY HISTORICAL REPLAY ")).toBe(false);
    expect(isHistoricalReplayConfirmed("")).toBe(false);
  });
});
