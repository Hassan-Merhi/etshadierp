---
name: excelHelper defval behavior — null vs undefined
description: defval in sheet_to_json only fills keys that are absent (undefined), not keys with explicit null values.
---

## The rule
`utils.sheet_to_json(ws, { defval: "" })` applies `defval` only when the key is **completely absent** from the row object (value was `undefined`). It does **not** override cells whose value is `null`.

## Why
`eachCell({ includeEmpty: true })` visits every cell in the row, including cells with `null` value. It stores `rowData[header] = null`. Since `rowData[header] !== undefined`, the defval condition `if (rowData[h] === undefined)` is never triggered.

`defval` IS applied for:
- Rows shorter than the header row (column never reached → key absent from `rowData`)

`defval` is NOT applied for:
- Explicit `null` cells (visited by `eachCell`, stored as `null`)
- `undefined` values stored explicitly (treated same as null by ExcelJS)

## Test expectation
```typescript
// Short row (C absent) → defval applies
ws.addRow(["A", "B", "C"]); ws.addRow(["x", "y"]);
sheet_to_json(ws, { defval: "" })[0].C === ""; // true

// Null cell → defval does NOT apply
ws.addRow(["A", "B", "C"]); ws.addRow(["x", null, "z"]);
sheet_to_json(ws, { defval: "" })[0].B === null; // true (null, not "")
```
