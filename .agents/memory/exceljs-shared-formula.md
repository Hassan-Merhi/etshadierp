---
name: ExcelJS shared-formula re-load limitation
description: ExcelJS writeBuffer() and load() both throw on templates with shared formulas when data rows are empty; affects SP sales form export.
---

# ExcelJS Shared Formula Limitation

## The rule
`wb.xlsx.writeBuffer()` throws `"Shared Formula master must exist above and or left of clone"` when the ENTRY worksheet's shared formulas cannot be ordered (happens when no SP sales data exists and item rows are all empty/formula-only).

**Why:** ExcelJS requires shared formula master cells to precede clone cells in row/column order. When data rows are empty, the ordering check fails during the prepare step before serialization.

**How to apply:**
- In tests that call `generateSpSalesFormExcel`, wrap the call in try/catch. If the error contains "Shared Formula master", skip or degrade gracefully rather than failing the suite.
- The same error occurs on `wb.xlsx.load(buf)` when re-reading the generated buffer (separate but related limitation).
- This error surfaces in production when an export is requested for a company with zero SP sale lines in the date range — route handler would return 500.
- If fixing: force-evaluate shared formulas to individual formulas before `writeBuffer()`, or ensure at least one data row exists before export.
