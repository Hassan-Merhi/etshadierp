/**
 * Unit tests for client/src/lib/apiResponseAdapters.ts — the defensive
 * response-normalisation helpers. These guard the UI against malformed or
 * shape-shifted API payloads (array vs. { accounts: [] } envelope), so a bad
 * response degrades to an empty list instead of crashing a render.
 */
import {
  unwrapArrayResponse,
  unwrapAccountsResponse,
  readJsonResponse,
  readArrayResponse,
  readAccountsResponse,
} from "@/lib/apiResponseAdapters";

function fakeResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as unknown as Response;
}

describe("unwrapArrayResponse", () => {
  it("returns arrays untouched", () => {
    expect(unwrapArrayResponse([1, 2, 3])).toEqual([1, 2, 3]);
    expect(unwrapArrayResponse([])).toEqual([]);
  });

  it("returns [] for any non-array value", () => {
    expect(unwrapArrayResponse(null)).toEqual([]);
    expect(unwrapArrayResponse(undefined)).toEqual([]);
    expect(unwrapArrayResponse({})).toEqual([]);
    expect(unwrapArrayResponse("nope")).toEqual([]);
    expect(unwrapArrayResponse(42)).toEqual([]);
  });
});

describe("unwrapAccountsResponse", () => {
  it("returns a bare array as-is", () => {
    expect(unwrapAccountsResponse([{ id: 1 }])).toEqual([{ id: 1 }]);
  });

  it("extracts the accounts array from an envelope", () => {
    const env = { accounts: [{ id: 7 }], asOfDate: "2026-01-01" };
    expect(unwrapAccountsResponse(env)).toEqual([{ id: 7 }]);
  });

  it("returns [] when the envelope's accounts field is not an array", () => {
    expect(unwrapAccountsResponse({ accounts: "oops" })).toEqual([]);
    expect(unwrapAccountsResponse({ accounts: null })).toEqual([]);
    expect(unwrapAccountsResponse({})).toEqual([]);
  });

  it("returns [] for primitives and null", () => {
    expect(unwrapAccountsResponse(null)).toEqual([]);
    expect(unwrapAccountsResponse(42)).toEqual([]);
    expect(unwrapAccountsResponse("x")).toEqual([]);
  });
});

describe("readJsonResponse", () => {
  it("resolves the parsed body on an ok response", async () => {
    await expect(readJsonResponse(fakeResponse({ a: 1 }), "err")).resolves.toEqual({ a: 1 });
  });

  it("throws the provided message on a non-ok response", async () => {
    await expect(readJsonResponse(fakeResponse(null, false), "boom")).rejects.toThrow("boom");
  });
});

describe("readArrayResponse", () => {
  it("normalises an ok array response", async () => {
    await expect(readArrayResponse(fakeResponse([1, 2]), "err")).resolves.toEqual([1, 2]);
  });

  it("normalises a non-array ok body to []", async () => {
    await expect(readArrayResponse(fakeResponse({ nope: true }), "err")).resolves.toEqual([]);
  });

  it("throws on a failed response", async () => {
    await expect(readArrayResponse(fakeResponse([], false), "failed")).rejects.toThrow("failed");
  });
});

describe("readAccountsResponse", () => {
  it("unwraps an accounts envelope from an ok response", async () => {
    await expect(
      readAccountsResponse(fakeResponse({ accounts: [{ id: 3 }] })),
    ).resolves.toEqual([{ id: 3 }]);
  });

  it("uses the default error message on failure", async () => {
    await expect(readAccountsResponse(fakeResponse(null, false))).rejects.toThrow(
      "Failed to fetch accounts",
    );
  });
});
