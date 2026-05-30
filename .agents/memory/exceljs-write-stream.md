---
name: ExcelJS write-stream bug
description: ExcelJS 3.x wb.xlsx.write(stream) throws "ea.results is not a Promise" — use writeBuffer() instead
---

## Rule
Never call `wb.xlsx.write(writableStream)` in ExcelJS 3.x. It internally fails with "ea.results is not a Promise" / "LODASH_PROPERTIES" errors causing all exports to abort.

**Why:** ExcelJS 3.10.0 has a broken internal promise chain when streaming directly to a writable. `writeBuffer()` bypasses this path entirely.

**How to apply:**
```typescript
// BAD
await wb.xlsx.write(outputStream);

// GOOD
const buf = await wb.xlsx.writeBuffer();
outputStream.write(buf as Buffer);
```
Applies to both `buildCompanyWorkbook` and `streamCompanyWorkbookDirect` in `server/services/exportExcelService.ts`.
