# Phase 9 — Large Export Memory Audit

This audit inventories the remaining standalone export paths that can allocate a complete XLSX, PDF, or ZIP in Node memory. It intentionally does not change accounting, inventory, costing, or report calculations.

## Shared protection added

`server/excelHelper.ts` now serializes both buffered and HTTP-streamed workbook writes through the global heavy-export coordinator. Routes already using `writeWorkbook`, `writeWorkbookToStream`, or `writeWorkbookToResponse` therefore cannot overlap with full-company export ZIP builds.

HTTP workbook responses also detect client disconnects and destroy the response instead of continuing an abandoned workbook write.

## Highest-priority server paths found

1. `server/routes/factory/factoryBaleExportRoutes.ts`
2. `server/routes/factory/customer-orders/orderExcelExportRoutes.ts`
3. `server/routes/factory/customer-orders/orderPdfExportRoutes.ts`
4. `server/routes/factory/factoryStockRoutes.ts`
5. `server/routes/factory/factoryCustomersRoutes.ts`
6. `server/routes/factoryPayrollRoutes.ts`
7. `server/routes/supplierProformaRoutes.ts`
8. `server/routes/rental/rentalUnitsContractsRoutes.ts`
9. `server/helpers/generateAllCompaniesNetPositionExcel.ts`
10. `server/helpers/generateNetPositionExcel.ts`
11. `server/routes/netProfitExcelRoute.ts`
12. `server/routes/factoryReportRoutes.ts`
13. `server/services/spSalesFormExport.ts`
14. `server/services/spSalesFormExportV2.ts`
15. `server/routes/sp/spExportRoutes.ts`

## Conversion rule

For browser downloads:

- Prefer `writeWorkbookToResponse(workbook, res, filename)`.
- Do not call `workbook.xlsx.writeBuffer()` followed by `res.send()`.
- Do not use `Buffer.concat()` for streamed ZIP or PDF delivery when a stream/file path is available.
- Preserve current workbook construction, formulas, ordering, permissions, and database queries.

For email or WhatsApp attachments:

- Complete bytes may remain necessary.
- Use the shared `writeWorkbook()` helper so generation is serialized.
- Reuse one generated attachment across retries.
- Clear references immediately after delivery attempts finish.

## Exclusions

Client-side Excel generation is not a Node server memory risk and is outside this phase unless it causes browser crashes. Import parsers that require a complete uploaded file are also outside the download-streaming conversion.

## Remaining implementation batches

- Batch A: factory bale, stock, payroll, and customer-order exports.
- Batch B: supplier proforma, rental, and net-position exports.
- Batch C: supplier-partner sales forms and remaining report routes.
- Batch D: PDF and ZIP routes where their libraries support direct response/file streaming.
