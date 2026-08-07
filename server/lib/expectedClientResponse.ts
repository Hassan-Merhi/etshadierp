import type { Response } from "express";

export const EXPECTED_CLIENT_RESPONSE_CODES = {
  BALE_SCAN_OVERLOAD: "bale_scan_overload",
  BALE_SCAN_NOT_IN_PROFORMA: "bale_scan_not_in_proforma",
} as const;

export type ExpectedClientResponseCode =
  (typeof EXPECTED_CLIENT_RESPONSE_CODES)[keyof typeof EXPECTED_CLIENT_RESPONSE_CODES];

const LOCAL_KEY = "expectedClientResponseCode";

/**
 * Marks an intentional 4xx business response so request monitoring can
 * distinguish it from a genuine client failure. This does not change the HTTP
 * status or response body, preserving existing client behavior.
 */
export function markExpectedClientResponse(res: Response, code: ExpectedClientResponseCode): void {
  (res.locals as Record<string, unknown>)[LOCAL_KEY] = code;
}

export function getExpectedClientResponseCode(res: Response): ExpectedClientResponseCode | null {
  const value = (res.locals as Record<string, unknown> | undefined)?.[LOCAL_KEY];
  if (
    value === EXPECTED_CLIENT_RESPONSE_CODES.BALE_SCAN_OVERLOAD ||
    value === EXPECTED_CLIENT_RESPONSE_CODES.BALE_SCAN_NOT_IN_PROFORMA
  ) {
    return value;
  }
  return null;
}
