import { describe, expect, it } from "vitest";
import type { Response } from "express";
import {
  EXPECTED_CLIENT_RESPONSE_CODES,
  getExpectedClientResponseCode,
  markExpectedClientResponse,
} from "./expectedClientResponse";

function responseWithLocals(locals: Record<string, unknown> = {}): Response {
  return { locals } as unknown as Response;
}

describe("expected client responses", () => {
  it("marks and reads bale scan overload confirmations", () => {
    const res = responseWithLocals();

    markExpectedClientResponse(res, EXPECTED_CLIENT_RESPONSE_CODES.BALE_SCAN_OVERLOAD);

    expect(getExpectedClientResponseCode(res)).toBe(EXPECTED_CLIENT_RESPONSE_CODES.BALE_SCAN_OVERLOAD);
  });

  it("marks and reads not-in-proforma confirmations", () => {
    const res = responseWithLocals();

    markExpectedClientResponse(res, EXPECTED_CLIENT_RESPONSE_CODES.BALE_SCAN_NOT_IN_PROFORMA);

    expect(getExpectedClientResponseCode(res)).toBe(EXPECTED_CLIENT_RESPONSE_CODES.BALE_SCAN_NOT_IN_PROFORMA);
  });

  it("does not classify unmarked or unknown responses as expected", () => {
    expect(getExpectedClientResponseCode(responseWithLocals())).toBeNull();
    expect(getExpectedClientResponseCode(responseWithLocals({ expectedClientResponseCode: "unknown" }))).toBeNull();
  });
});
