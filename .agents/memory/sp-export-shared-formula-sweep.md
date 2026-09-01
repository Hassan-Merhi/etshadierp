---
name: SP export shared-formula pre-sweep
description: spSalesFormExport pre-sweep must use row.getCell(c) column-by-column, NOT eachCell, to guarantee all slave cells are cleared before writeBuffer().
---

## The rule
In `server/services/spSalesFormExport.ts`, the pre-sweep that clears `sharedFormula` slave cells must:
1. Cover **all columns** in the date-block region (column index >= `E_DATE_START = 7`)
2. Use **explicit `row.getCell(c)` per column** — NOT `row.eachCell({ includeEmpty: false })`

## Why
### Part 1 — column scope
The template has shared-formula chains spanning qty (`baseCol+0`), price (`baseCol+1`), AND profit (`baseCol+2`) for every day slot (including days beyond the export range). Limiting the sweep to only profit columns leaves qty/price slave cells with broken references.

### Part 2 — eachCell is not sufficient
`row.eachCell({ includeEmpty: false })` only iterates cells that ExcelJS has already **materialised** in its in-memory `_cells` array. Slave shared-formula cells that Excel omitted from the XML (because their computed value was empty/zero — no `<c>` element written) are **absent from `_cells`**, so `eachCell` silently skips them.

However, ExcelJS's internal shared-formula tracker still knows about those slaves via the master's declared `ref` range. During `writeBuffer()`, ExcelJS tries to write them back and finds the master gone (or replaced) → throws "Shared Formula master must exist above and or left of clone".

Observed: cell AN134 (col 40 = qty column for day 11, row 134) was skipped by `eachCell` because it wasn't materialised. Error surfaced whenever the export date range was fewer than 12 days.

## How to apply
Current implementation:
```typescript
const entryLastCol = entryWs.columnCount;
for (let r = E_DATA_START; r <= E_DATA_END; r++) {
  const row = entryWs.getRow(r);
  let rowChanged = false;
  for (let c = E_DATE_START; c <= entryLastCol; c++) {
    const cell = row.getCell(c);          // forces materialisation
    const v = cell.value as any;
    if (v && typeof v === "object" && "sharedFormula" in v) {
      cell.value = null;
      rowChanged = true;
    }
  }
  if (rowChanged) row.commit();
}
```

`row.getCell(c)` forces ExcelJS to create/access the cell object even if it was absent from the XML, guaranteeing that the sharedFormula reference is found and cleared.

The guard `c >= E_DATE_START` preserves static formula columns (A–F: item name, cost/bag, opening stock totals) which must remain formula-backed.

## Test coverage
`tests/excel-export.test.ts` verifies the export produces a valid workbook without throwing, the seeded item row has correct qty on day 0, and qty cells beyond the export range are null.
