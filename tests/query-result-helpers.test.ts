import { describe, expect, it } from "vitest";

import { firstRow, hasRows, resultRows } from "../server/lib/queryResult";

describe("raw query result helpers", () => {
  it("reads rows from a pg QueryResult", () => {
    expect(resultRows({ rows: [{ id: 1 }, { id: 2 }] })).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("accepts a result that is already an array", () => {
    // Older drizzle releases resolved execute() to the rows themselves, which
    // is why call sites carry `(x as any).rows ?? x`. Preserving that here is
    // what makes replacing those expressions behaviour-preserving.
    expect(resultRows([{ id: 1 }])).toEqual([{ id: 1 }]);
  });

  it("returns an empty array for a result with no rows", () => {
    expect(resultRows({})).toEqual([]);
    expect(resultRows(null)).toEqual([]);
    expect(resultRows(undefined)).toEqual([]);
    expect(resultRows({ rows: null })).toEqual([]);
  });

  it("returns undefined rather than a phantom row when empty", () => {
    // The reason firstRow exists instead of resultRows(...)[0]: without
    // noUncheckedIndexedAccess that index would type an absent row as present.
    expect(firstRow({ rows: [] })).toBeUndefined();
    expect(firstRow({ rows: [{ id: 7 }] })).toEqual({ id: 7 });
  });

  it("reports whether a query returned anything", () => {
    expect(hasRows({ rows: [{ id: 1 }] })).toBe(true);
    expect(hasRows({ rows: [] })).toBe(false);
    expect(hasRows(null)).toBe(false);
  });

  it("does not mistake a string for a row collection", () => {
    expect(resultRows("rows")).toEqual([]);
    expect(hasRows(42)).toBe(false);
  });
});
