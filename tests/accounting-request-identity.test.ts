import { describe, expect, it } from "vitest";
import {
  attachAccountingRequestIdentity,
  releaseAccountingRequestIdentity,
} from "../client/src/lib/accountingRequestIdentity";

const URL = "/api/vouchers/journal";

function payload() {
  return {
    voucherDate: "2026-07-25",
    notes: "Retry-safe journal",
    optional: false,
    entries: [
      { type: "DR", accountType: "ledger", accountId: 10, amount: "50" },
      { type: "CR", accountType: "bank", accountId: 20, amount: "50" },
    ],
  };
}

describe("accounting request identity", () => {
  it("reuses the same identity for the same uncertain journal retry", () => {
    const first = attachAccountingRequestIdentity("POST", URL, payload()) as Record<string, unknown>;
    const retry = attachAccountingRequestIdentity("POST", URL, payload()) as Record<string, unknown>;

    expect(typeof first.clientRequestId).toBe("string");
    expect(retry.clientRequestId).toBe(first.clientRequestId);

    releaseAccountingRequestIdentity("POST", URL, first);
  });

  it("releases an acknowledged identity so a later intentional journal is new", () => {
    const first = attachAccountingRequestIdentity("POST", URL, payload()) as Record<string, unknown>;
    releaseAccountingRequestIdentity("POST", URL, first);
    const later = attachAccountingRequestIdentity("POST", URL, payload()) as Record<string, unknown>;

    expect(later.clientRequestId).not.toBe(first.clientRequestId);
    releaseAccountingRequestIdentity("POST", URL, later);
  });

  it("preserves an identity already stored in an offline replay body", () => {
    const queued = { ...payload(), clientRequestId: "queued-request-1" };
    expect(attachAccountingRequestIdentity("POST", URL, queued)).toBe(queued);
  });

  it("does not add an identity to optional journals or unrelated requests", () => {
    const optional = { ...payload(), optional: true };
    expect(attachAccountingRequestIdentity("POST", URL, optional)).toBe(optional);

    const unrelated = payload();
    expect(attachAccountingRequestIdentity("POST", "/api/vouchers/payment", unrelated)).toBe(unrelated);
  });
});
