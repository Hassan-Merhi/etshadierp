/**
 * Unit tests for server/lib/parseId.ts — the positive-integer ID guards used at
 * the top of route handlers to keep NaN out of Drizzle/Postgres (bad input → a
 * clean null the caller turns into 400, instead of a confusing 500).
 */
import { parseId, parseOptionalId } from "../server/lib/parseId";

describe("parseId", () => {
  it("accepts positive integers as strings or numbers", () => {
    expect(parseId("5")).toBe(5);
    expect(parseId(5)).toBe(5);
    expect(parseId("1000000")).toBe(1000000);
  });

  it("rejects zero and negatives", () => {
    expect(parseId("0")).toBeNull();
    expect(parseId(0)).toBeNull();
    expect(parseId("-3")).toBeNull();
    expect(parseId(-3)).toBeNull();
  });

  it("rejects non-integers", () => {
    expect(parseId("5.5")).toBeNull();
    expect(parseId(5.5)).toBeNull();
  });

  it("rejects non-numeric strings and empty string", () => {
    expect(parseId("abc")).toBeNull();
    expect(parseId("")).toBeNull();
    expect(parseId("12abc")).toBeNull();
  });

  it("rejects non-string/number types", () => {
    expect(parseId(null)).toBeNull();
    expect(parseId(undefined)).toBeNull();
    expect(parseId(true as unknown)).toBeNull();
    expect(parseId({} as unknown)).toBeNull();
    expect(parseId([] as unknown)).toBeNull();
  });

  it("rejects NaN and Infinity", () => {
    expect(parseId(NaN)).toBeNull();
    expect(parseId(Infinity)).toBeNull();
  });
});

describe("parseOptionalId", () => {
  it("treats undefined, null, and empty string as a valid absence (null)", () => {
    expect(parseOptionalId(undefined)).toBeNull();
    expect(parseOptionalId(null)).toBeNull();
    expect(parseOptionalId("")).toBeNull();
  });

  it("validates a present value like parseId", () => {
    expect(parseOptionalId("7")).toBe(7);
    expect(parseOptionalId("0")).toBeNull();
    expect(parseOptionalId("bad")).toBeNull();
  });
});
