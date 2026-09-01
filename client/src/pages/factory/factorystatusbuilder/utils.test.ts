/**
 * Status-builder sheets: linked cells, differences and totals.
 *
 * A cell can pull its value from a cell on another sheet, and those links can
 * chain — which means they can also loop. The resolver has to notice a loop
 * instead of recursing until the tab dies, and the footer arithmetic has to skip
 * the derived columns so a total does not count its own difference column.
 */
import { describe, expect, it } from "vitest";
import {
  calcDiff,
  calcTotal,
  computeDiffValue,
  computeTotalValue,
  fromApiSheet,
  getEffectiveValue,
  isDiffColumn,
  isTotalColumn,
  fmt,
  makeId,
  parseCellValue,
  resolveCellValue,
} from "./utils";
import type { StatusBuilderSheet } from "./types";

function sheet(overrides: Partial<StatusBuilderSheet> = {}): StatusBuilderSheet {
  return {
    id: 1,
    stableId: "sheet_1",
    name: "Sheet 1",
    columns: [
      { id: "c1", label: "Opening" },
      { id: "c2", label: "Closing" },
      { id: "c3", label: "DIFF" },
    ],
    rows: [
      { id: "r1", label: "Line 1", cells: [{ value: 10 }, { value: 4 }, { value: null }] },
      { id: "r2", label: "Line 2", cells: [{ value: 5 }, { value: 5 }, { value: null }] },
    ],
    lockedColumns: [],
    dirty: false,
    footerMode: "diff",
    ...overrides,
  };
}

describe("sheet loading", () => {
  it("gives every generated id a distinct value", () => {
    const ids = new Set(Array.from({ length: 50 }, () => makeId()));
    expect(ids.size).toBe(50);
  });

  it("accepts columns given as plain strings or as objects", () => {
    const loaded = fromApiSheet({
      id: 3,
      name: "Loaded",
      columns: ["Opening", { id: "c2", label: "Closing" }],
      rows: [],
    } as never);

    expect(loaded.columns[0].label).toBe("Opening");
    expect(loaded.columns[1]).toEqual({ id: "c2", label: "Closing" });
    expect(loaded.stableId).toBe("sheet_3");
  });

  it("accepts cells given as bare values, objects or nulls", () => {
    const loaded = fromApiSheet({
      id: 3,
      name: "Loaded",
      columns: ["A", "B", "C"],
      rows: [{ id: "r1", label: "Line", cells: [7, "text", null] }],
    } as never);

    expect(loaded.rows[0].cells.map((cell) => cell.value)).toEqual([7, "text", null]);
  });

  it("pads a short row so it lines up with the columns", () => {
    const loaded = fromApiSheet({
      id: 3,
      name: "Loaded",
      columns: ["A", "B", "C"],
      rows: [{ id: "r1", label: "Line", cells: [1] }],
    } as never);

    // A row shorter than the header would otherwise put later values under the
    // wrong column as soon as one is typed.
    expect(loaded.rows[0].cells).toHaveLength(3);
  });

  it("survives a sheet whose columns or rows are missing entirely", () => {
    const loaded = fromApiSheet({ id: 4, name: "Empty" } as never);

    expect(loaded.columns).toEqual([]);
    expect(loaded.rows).toEqual([]);
  });
});

describe("derived column labels", () => {
  it("recognises a difference column in either language", () => {
    expect(isDiffColumn("diff")).toBe(true);
    expect(isDiffColumn(" Difference ")).toBe(true);
    expect(isDiffColumn("فرق")).toBe(true);
    expect(isDiffColumn("Opening")).toBe(false);
  });

  it("recognises a total column in either language", () => {
    expect(isTotalColumn("TOTAL")).toBe(true);
    expect(isTotalColumn("مجموع")).toBe(true);
    expect(isTotalColumn("Subtotal")).toBe(false);
  });
});

describe("footer arithmetic", () => {
  const labels = ["Opening", "Closing", "DIFF"];

  it("subtracts the two data columns to its left", () => {
    expect(computeDiffValue(labels, [10, 4, null], 2)).toBe(6);
  });

  it("has no difference to show without two numbers", () => {
    expect(computeDiffValue(labels, [10, null, null], 2)).toBeNull();
    expect(computeDiffValue(["Opening", "DIFF"], [10, null], 1)).toBeNull();
  });

  it("totals the data columns and ignores the derived ones", () => {
    // A total that counted the difference column would double-count the gap
    // between the two values it was computed from.
    expect(computeTotalValue(["A", "B", "DIFF", "TOTAL"], [10, 4, 6, 20])).toBe(14);
  });

  it("has no total to show when no column holds a number", () => {
    expect(computeTotalValue(["A", "B"], [null, null])).toBeNull();
  });

  it("computes the footer row of a sheet", () => {
    const sheets = [sheet()];
    expect(calcDiff(sheets, sheets[0])).toEqual([15, 9, 6]);
    expect(calcTotal(sheets, sheets[0])).toEqual([15, 9, null]);
  });
});

describe("cell text", () => {
  it("shows an empty cell as empty rather than as zero", () => {
    expect(fmt(null)).toBe("");
    expect(fmt(undefined)).toBe("");
  });

  it("groups thousands and keeps up to four decimals", () => {
    expect(fmt(1234.5678)).toBe("1,234.5678");
    expect(fmt(1000)).toBe("1,000");
  });

  it("reads a typed number back as a number, commas and all", () => {
    expect(parseCellValue("1,234.5")).toBe(1234.5);
    expect(parseCellValue(" 42 ")).toBe(42);
  });

  it("keeps text the user meant as text", () => {
    expect(parseCellValue("n/a")).toBe("n/a");
    // A lone dash is how the sheet is written for "nothing here", and it must
    // survive a round trip rather than becoming a zero.
    expect(parseCellValue("-")).toBe("-");
    expect(parseCellValue("   ")).toBeNull();
  });
});

describe("linked cells", () => {
  const source = sheet();
  const target = sheet({
    id: 2,
    stableId: "sheet_2",
    name: "Sheet 2",
    rows: [
      {
        id: "r1",
        label: "Linked",
        cells: [
          {
            value: null,
            link: { type: "status_builder_cell", sourceSheetId: "sheet_1", sourceRowId: "r1", sourceColumnId: "c1" },
          },
          { value: 1 },
          { value: null },
        ],
      },
    ],
  });

  it("reads the value from the cell it points at", () => {
    expect(getEffectiveValue([source, target], target.rows[0].cells[0])).toBe(10);
  });

  it("reports a link to a sheet, row or column that is gone", () => {
    expect(resolveCellValue([source], "sheet_missing", "r1", "c1").broken).toBe(true);
    expect(resolveCellValue([source], "sheet_1", "r_missing", "c1").broken).toBe(true);
    expect(resolveCellValue([source], "sheet_1", "r1", "c_missing").broken).toBe(true);
  });

  it("shows nothing rather than a stale number when the link is broken", () => {
    const orphan = {
      value: 99,
      link: { type: "status_builder_cell" as const, sourceSheetId: "gone", sourceRowId: "r1", sourceColumnId: "c1" },
    };

    expect(getEffectiveValue([source], orphan)).toBeNull();
  });

  it("stops instead of recursing forever when two cells point at each other", () => {
    const left = sheet({
      id: 1,
      stableId: "sheet_1",
      rows: [
        {
          id: "r1",
          label: "Left",
          cells: [
            {
              value: null,
              link: { type: "status_builder_cell", sourceSheetId: "sheet_2", sourceRowId: "r1", sourceColumnId: "c1" },
            },
          ],
        },
      ],
      columns: [{ id: "c1", label: "A" }],
    });
    const right = sheet({
      id: 2,
      stableId: "sheet_2",
      rows: [
        {
          id: "r1",
          label: "Right",
          cells: [
            {
              value: null,
              link: { type: "status_builder_cell", sourceSheetId: "sheet_1", sourceRowId: "r1", sourceColumnId: "c1" },
            },
          ],
        },
      ],
      columns: [{ id: "c1", label: "A" }],
    });

    const resolved = resolveCellValue([left, right], "sheet_1", "r1", "c1");
    expect(resolved.circular).toBe(true);
    expect(resolved.value).toBeNull();
  });

  it("reads a sheet's difference row through a link", () => {
    const resolved = resolveCellValue([source], "sheet_1", "__diff__", "c1");

    expect(resolved.broken).toBe(false);
    expect(resolved.value).toBe(15);
  });
});
