---
name: SP export shared-formula pre-sweep
description: spSalesFormExport pre-sweep scope — must cover all date-block columns, not just profit column, to avoid ExcelJS "Shared Formula master" error on writeBuffer.
---

## The rule
In `server/services/spSalesFormExport.ts`, the pre-sweep that clears `sharedFormula` slave cells must target **all columns in the date-block region** (column index >= `E_DATE_START = 7`), not just the profit column (`baseCol+2` for each exported day).

## Why
The supplier_partner_sales_form_template.xlsx has shared-formula chains that span the qty column (`baseCol+0`), price column (`baseCol+1`), AND profit column (`baseCol+2`) for every day slot (including slots beyond the export date range). If only the profit column is swept, qty/price slave cells remain with broken references and ExcelJS throws "Shared Formula master must exist above and or left of clone" during `writeBuffer()`.

Confirmed by error: cell AN134 (col 40 = qty column for day 11, row 134 = slave) was not cleared by the profit-only sweep.

## How to apply
The current implementation uses:
```typescript
row.eachCell({ includeEmpty: false }, (cell) => {
  if (cell.col < E_DATE_START) return; // preserve static columns A–F
  const v = cell.value as any;
  if (v && typeof v === "object" && "sharedFormula" in v) {
    cell.value = null;
    rowChanged = true;
  }
});
```

The guard `cell.col < E_DATE_START` preserves static formula columns (item name, opening stock, cost totals in A–F) which are NOT part of the per-day data block and must remain formula-backed.

## Test coverage
`tests/excel-export.test.ts` verifies: the export produces a real workbook (not throwing), the seeded "Shoes" row has qty=10 on day 0, and qty cells beyond the export range are null.
