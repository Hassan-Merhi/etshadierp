import { isAbortError, isBlockingQueryError } from "@/lib/abortError";

/**
 * Stock On The Way showed "Error Loading Data — Failed to load containers"
 * directly above 119 containers and 1,144 items it had loaded perfectly well.
 * React Query keeps the last successful data when a background refetch fails,
 * so the page had both `data` and `error`, and the banner keyed off `error`
 * alone.
 */
describe("blocking query error classification", () => {
  it("recognizes cancellation, which is not a failure", () => {
    expect(isAbortError(new DOMException("The operation was aborted.", "AbortError"))).toBe(true);
    expect(isAbortError(Object.assign(new Error("cancelled"), { name: "CancelledError" }))).toBe(true);
    expect(isAbortError(new Error("500 Internal Server Error"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });

  it("stays quiet when data is still on screen after a failed refetch", () => {
    expect(isBlockingQueryError(new Error("Failed to load containers"), true)).toBe(false);
  });

  it("reports a real failure that left the page with nothing", () => {
    expect(isBlockingQueryError(new Error("Failed to load containers"), false)).toBe(true);
  });

  it("never reports a cancelled request, with or without data", () => {
    const aborted = new DOMException("The operation was aborted.", "AbortError");
    expect(isBlockingQueryError(aborted, false)).toBe(false);
    expect(isBlockingQueryError(aborted, true)).toBe(false);
  });

  it("reports nothing when there is no error at all", () => {
    expect(isBlockingQueryError(null, false)).toBe(false);
    expect(isBlockingQueryError(undefined, true)).toBe(false);
  });
});
