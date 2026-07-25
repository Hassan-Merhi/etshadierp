/**
 * Unit tests for client/src/lib/historicalReplayPreparedRequest.ts — the client
 * side of the two-step historical-replay guard. The security property under
 * test: an "apply" request is rebuilt from the SERVER-returned frozen state (or,
 * if the cache is gone, sends only the signed token) — it never trusts live
 * checkbox/selection state.
 */
import {
  HISTORICAL_REPLAY_APPLY_PATH,
  isHistoricalReplayApplyEndpoint,
  historicalReplayTokenFromRequest,
  isHistoricalReplayPrepareRequest,
  rememberHistoricalReplayPreparation,
  freezeHistoricalReplayApplyRequest,
  forgetHistoricalReplayPreparation,
  clearHistoricalReplayPreparations,
} from "@/lib/historicalReplayPreparedRequest";

beforeEach(() => clearHistoricalReplayPreparations());

describe("isHistoricalReplayApplyEndpoint", () => {
  it("matches only a POST to the apply path", () => {
    expect(isHistoricalReplayApplyEndpoint("POST", HISTORICAL_REPLAY_APPLY_PATH)).toBe(true);
    expect(isHistoricalReplayApplyEndpoint("post", HISTORICAL_REPLAY_APPLY_PATH)).toBe(true);
    expect(isHistoricalReplayApplyEndpoint("GET", HISTORICAL_REPLAY_APPLY_PATH)).toBe(false);
    expect(isHistoricalReplayApplyEndpoint("POST", "/api/other")).toBe(false);
  });
});

describe("historicalReplayTokenFromRequest", () => {
  it("extracts a non-empty confirmationToken from an apply request", () => {
    expect(
      historicalReplayTokenFromRequest("POST", HISTORICAL_REPLAY_APPLY_PATH, { confirmationToken: "tok-1" }),
    ).toBe("tok-1");
  });

  it("returns null for the wrong endpoint, missing token, or empty token", () => {
    expect(historicalReplayTokenFromRequest("POST", "/api/other", { confirmationToken: "t" })).toBeNull();
    expect(historicalReplayTokenFromRequest("POST", HISTORICAL_REPLAY_APPLY_PATH, {})).toBeNull();
    expect(historicalReplayTokenFromRequest("POST", HISTORICAL_REPLAY_APPLY_PATH, { confirmationToken: "" })).toBeNull();
    expect(historicalReplayTokenFromRequest("POST", HISTORICAL_REPLAY_APPLY_PATH, null)).toBeNull();
  });
});

describe("isHistoricalReplayPrepareRequest", () => {
  it("is true for a dry-run apply with no token", () => {
    expect(isHistoricalReplayPrepareRequest("POST", HISTORICAL_REPLAY_APPLY_PATH, { dryRun: true })).toBe(true);
  });

  it("is false when a token is present or dryRun is not true", () => {
    expect(
      isHistoricalReplayPrepareRequest("POST", HISTORICAL_REPLAY_APPLY_PATH, { dryRun: true, confirmationToken: "t" }),
    ).toBe(false);
    expect(isHistoricalReplayPrepareRequest("POST", HISTORICAL_REPLAY_APPLY_PATH, { dryRun: false })).toBe(false);
  });
});

describe("rememberHistoricalReplayPreparation", () => {
  const validPayload = {
    confirmationToken: "tok-A",
    safeSupplierIds: [3, 1, 1, 2],
    frozenOptions: { includeCompletedBatches: true, includeFinalizedBales: false },
    algorithmVersion: "v4",
    fingerprint: "fp-1",
  };

  it("accepts a well-formed prepared response", () => {
    expect(rememberHistoricalReplayPreparation(validPayload)).toBe(true);
  });

  it("rejects payloads missing required fields or with bad supplier ids", () => {
    expect(rememberHistoricalReplayPreparation(null)).toBe(false);
    expect(rememberHistoricalReplayPreparation({ ...validPayload, confirmationToken: "" })).toBe(false);
    expect(rememberHistoricalReplayPreparation({ ...validPayload, safeSupplierIds: [] })).toBe(false);
    expect(rememberHistoricalReplayPreparation({ ...validPayload, safeSupplierIds: [0, -1] })).toBe(false);
    expect(rememberHistoricalReplayPreparation({ ...validPayload, frozenOptions: { includeCompletedBatches: 1 } })).toBe(false);
    expect(rememberHistoricalReplayPreparation({ ...validPayload, algorithmVersion: "" })).toBe(false);
  });
});

describe("freezeHistoricalReplayApplyRequest", () => {
  const payload = {
    confirmationToken: "tok-B",
    safeSupplierIds: [5, 2, 2],
    frozenOptions: { includeCompletedBatches: false, includeFinalizedBales: true },
    algorithmVersion: "v4",
  };

  it("returns the data untouched for non-apply requests", () => {
    const data = { anything: true };
    expect(freezeHistoricalReplayApplyRequest("POST", "/api/other", data)).toBe(data);
  });

  it("rebuilds the request from frozen server state (deduped, sorted supplier ids)", () => {
    rememberHistoricalReplayPreparation(payload);
    const out = freezeHistoricalReplayApplyRequest("POST", HISTORICAL_REPLAY_APPLY_PATH, {
      confirmationToken: "tok-B",
      // live UI state that must be ignored:
      supplierIds: [999],
      includeCompletedBatches: true,
    });
    expect(out).toEqual({
      dryRun: false,
      confirmationToken: "tok-B",
      supplierIds: [2, 5],
      includeCompletedBatches: false,
      includeFinalizedBales: true,
      algorithmVersion: "v4",
      fingerprint: undefined,
    });
  });

  it("sends only the signed token when the preparation cache is missing", () => {
    // e.g. after a page reload — nothing remembered for this token.
    const out = freezeHistoricalReplayApplyRequest("POST", HISTORICAL_REPLAY_APPLY_PATH, {
      confirmationToken: "tok-unknown",
      supplierIds: [1, 2, 3],
    });
    expect(out).toEqual({ dryRun: false, confirmationToken: "tok-unknown" });
  });

  it("stops rebuilding after the preparation is forgotten", () => {
    rememberHistoricalReplayPreparation(payload);
    forgetHistoricalReplayPreparation("tok-B");
    const out = freezeHistoricalReplayApplyRequest("POST", HISTORICAL_REPLAY_APPLY_PATH, {
      confirmationToken: "tok-B",
    });
    expect(out).toEqual({ dryRun: false, confirmationToken: "tok-B" });
  });
});
