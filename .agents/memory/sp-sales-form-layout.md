---
name: SP Sales Form template layout
description: ENTRY sheet column layout and write rules for spSalesFormExport.ts — critical for avoiding column corruption
---

## ENTRY sheet column map (confirmed by cell inspection)

| Col | Letter | Content |
|-----|--------|---------|
| 5   | E      | Opening Stock Qty (write directly — ExcelJS can't recalculate Costing SUMIFS) |
| 6   | F      | Avg Cost per Bag (write directly; always write 0 not null when qty=0 to prevent #DIV/0!) |
| 7   | G      | First date block start (day 0) |
| 7–60 | G–BH | 18 date blocks × 3 cols each (Qty / Sale Price / Profit/Bag) |
| 61  | BI     | Empty separator — no data |
| 62  | BJ     | Closing Stock Qty (written directly; template has shared-formula here) |
| 63  | BK     | Closing Stock Value (written directly) |
| 65+ |        | Avg Monthly Sales, Ageing — fixed template columns, never touch |

`E_TEMPLATE_MAX_DAYS = 18` (days 0–17, cols 7–60)

## Critical write rules

1. **Capacity guard**: `effectiveDayCount = Math.min(dayCount, E_TEMPLATE_MAX_DAYS)`. All write/clear loops use `effectiveDayCount`, not `dayCount`. Log a warning when clamped.

2. **Beyond-range clear loops for ENTRY** must stop at `E_TEMPLATE_MAX_DAYS`, never use `dayCount + 40` — that formula reaches col 62-63 (Closing Stock) and wipes them.

3. **Unconditional cell clear**: ENTRY item data cells (Qty, Price, Profit) must be cleared with `cell.value = null` *before* writing — do NOT use `if (!isFormula(cell))` guard, as template formula cells must be overwritten with real data or null.

4. **Same for Sales item rows**: remove `if (isFormula(cell)) continue` — stale formula cells in Sales item rows must be replaced with actual qty or null.

5. **Opening Stock** (col E) and **Cost/Bag** (col F): write plain values directly in every item row. Don't rely on SUMIFS formulas pointing at Costing sheet — ExcelJS cannot recalculate cross-sheet formulas.

6. **Closing Stock** (cols BJ/BK): compute as `closingQty = max(0, openingQty − totalSoldInRange)` and write directly *after* the beyond-range clear loop (which correctly stops at col 60).  
   - When `openingQty > 0`: write the number (including 0 when all sold) for correct downstream SUM semantics.  
   - When `openingQty = 0`: write null (nothing to report).

**Why:** The template formula at BJ5 is `E5-SUMIF(E$4:BI$4,BJ$4,E5:BI5)` — ExcelJS cannot recalculate it. Without direct writes, Closing Stock is always blank. The old `dayCount+40` clear loop silently wiped the "Closing Stock" label row and item row formulas whenever `dayCount < 18`.
