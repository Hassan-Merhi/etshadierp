---
name: xlsx→excelHelper migration context
description: The client-side xlsx→ExcelJS migration predates Phase 4; the shim lives in client/src/lib/excelHelper.ts; server routes still use raw xlsx.
---

## Status
- `client/src/lib/excelHelper.ts` is an **existing** ExcelJS compatibility shim that wraps the ExcelJS API to look like the SheetJS (`xlsx`) API surface.
- The migration of **client files** from `import ... from 'xlsx'` to `import { utils } from '@/lib/excelHelper'` was done in a session **prior to Phase 4**. Phase 4 only added regression tests and the 500→400 fix in importRoutes.ts.
- No `npm audit fix --force` was run in Phase 4.

## What remains unchanged
- `xlsx@0.18.5` and `exceljs@3.4.0` **both remain** in `package.json`.
- Server-side routes (`factoryWorkerRoutes.ts`, `factorySheetsRoutes.ts`, `factoryStatusBuilderSheetsRoutes.ts`) still import from `xlsx` directly.
- The `server/excelHelper.ts` is a separate server-side utility that uses ExcelJS directly (unrelated to the client shim).

## Test coverage
`tests/excel-helper.test.ts` — 59 tests covering all exported utils.* functions, read(), readFromBuffer(), round-trips, and defval/formula behaviors.
