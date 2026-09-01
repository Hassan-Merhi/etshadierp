---
name: ExcelJS write-stream bug
description: ExcelJS 3.x wb.xlsx.write(stream) throws "ea.results is not a Promise" and produces 0-byte files. Always use writeBuffer() + Buffer.from().
---

## Rule
Never call `workbook.xlsx.write(stream)` or `workbook.xlsx.write(res)`. ExcelJS 3.x throws `"ea.results is not a Promise"` and sends 0 bytes.

**Always use:**
```typescript
const buf = Buffer.from(await workbook.xlsx.writeBuffer());
res.end(buf);      // for HTTP responses
res.send(buf);     // alternative
stream.write(buf); // for Writable streams
```

**Why:** ExcelJS 3.x changed its internal streaming implementation; the stream-write API is broken.  
**How to apply:** Any new Excel export endpoint must use `writeBuffer()`. The `writeWorkbookToResponse` and `writeWorkbookToStream` helpers in `server/excelHelper.ts` were updated to use `writeBuffer()` internally — callers of those helpers are safe.

## Files fixed (2026-07-21)
All of these had missing `Buffer.from()` or used the broken stream API, producing 0-byte downloads:
- `server/excelHelper.ts` — `writeWorkbookToStream` and `writeWorkbookToResponse` both rewritten to use `writeBuffer()`
- `server/routes/supplierProformaRoutes.ts` — proforma export (line ~1748)
- `server/routes/supplierProfitCheckRoutes.ts` — two export endpoints (lines ~649, ~872)
- `server/routes/gitRoutes.ts` — ETA template and container import template (lines ~877, ~1023)
- `server/routes/accountRoutes.ts` — account statement export (line ~2318)
- `server/services/exportExcelService.ts` — buffered export service (line ~526)

## Pattern that was wrong
```typescript
const buf = await wb.xlsx.writeBuffer(); // returns ArrayBuffer/Uint8Array
res.send(buf);  // 0 bytes — Express doesn't handle ArrayBuffer
```

## Pattern that is correct
```typescript
const buf = Buffer.from(await wb.xlsx.writeBuffer()); // explicit Node Buffer
res.send(buf);  // correct binary response
```
