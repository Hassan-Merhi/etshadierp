# Phase 9 — Large Export Memory Stabilization

Status: **implementation complete on `agent/memory-phase-1-stabilization`**.

This phase protects the remaining standalone XLSX, PDF, and ZIP generation paths without changing accounting, inventory, costing, report calculations, workbook layouts, formulas, permissions, ordering, or database queries.

## Completed protection layers

### 1. Shared explicit streaming helpers

`server/excelHelper.ts` serializes buffered and HTTP-streamed workbook writes through the heavy-export coordinator.

Routes already using `writeWorkbook`, `writeWorkbookToStream`, or `writeWorkbookToResponse` therefore:

- do not overlap with other heavy exports;
- stream browser downloads directly;
- stop abandoned browser responses;
- preserve buffered bytes only for attachment workflows that require them.

### 2. Legacy export compatibility bridge

`server/exportBufferBridge.mjs` is preloaded by both development and production startup commands.

It protects older routes that still call `workbook.xlsx.writeBuffer()` directly:

- browser XLSX downloads are written to a temporary file and streamed to the response;
- the final workbook is not duplicated into a full response Buffer;
- temporary files are deleted after success, disconnect, or failure;
- stale files are removed during startup;
- email, WhatsApp, scheduled, and notification paths still receive real Buffers when required;
- all remaining buffered workbook generation is serialized through the same global heavy-export queue.

### 3. PDF and ZIP chunk protection

For application-owned final `Buffer.concat()` calls on PDF or ZIP attachment responses:

- existing chunks are streamed sequentially instead of allocating a second contiguous Buffer;
- chunk references are cleared after delivery;
- browser disconnects terminate delivery and cleanup;
- calls originating inside PDFKit, ExcelJS, Archiver, or other dependencies are explicitly excluded from interception.

PDFKit routes already using `doc.pipe(res)` remain unchanged because they already stream correctly.

### 4. One global export queue

`server/services/heavyExportCoordinator.ts` and the preload bridge share:

- one global active count;
- one queue;
- one timeout policy;
- one AsyncLocalStorage re-entrancy context.

This prevents nested helper calls from deadlocking and prevents legacy routes from running concurrently with newer streamed exports.

## Batch coverage

### Batch A — completed

- Factory bale exports
- Factory stock exports
- Payroll exports
- Customer-order Excel exports
- Customer-order PDF exports

Direct PDFKit streams remain direct. Legacy workbook calls are handled by the compatibility bridge.

### Batch B — completed

- Supplier proforma exports
- Rental exports
- Net-position exports
- All-company net-position exports
- Net-profit Excel exports

Explicit helper users stream normally; remaining direct workbook calls are bridged and serialized.

### Batch C — completed

- Supplier Partner sales-form exports
- Supplier Partner V2 exports
- Factory report exports
- Remaining report downloads

Browser downloads are streamed or bridged. Attachment workflows retain one required Buffer and cannot overlap with another heavy export.

### Batch D — completed

- PDF response chunk duplication protection
- ZIP response chunk duplication protection
- Full-company ZIP temporary-file streaming
- Partial-file cleanup
- Stale archive cleanup
- Client-disconnect cleanup

## Audit and verification

`npm run audit:exports` now reports both the legacy syntax and its protection classification.

It distinguishes:

- browser stream or serialized attachment;
- browser chunk stream or required attachment buffer;
- bridge infrastructure;
- genuinely unprotected high-risk findings.

Set `EXPORT_BUFFER_AUDIT_FAIL=1` to fail only when a high-risk pattern is genuinely unprotected.

A standalone smoke verifier is available at:

`node scripts/verify-phase9-export-bridge.mjs`

It checks preload wiring, shared coordinator wiring, a real legacy `writeBuffer()` browser download, XLSX validity, response length, required attachment Buffer behavior, and temporary-file cleanup.

The smoke verifier and CI were intentionally not executed while this branch was being edited.

## Configuration

- `HEAVY_EXPORT_MAX_CONCURRENT` — default `1`
- `HEAVY_EXPORT_MAX_QUEUE` — default `6`
- `HEAVY_EXPORT_WAIT_TIMEOUT_MS` — default `900000`
- `EXPORT_CHUNK_BRIDGE_MIN_BYTES` — default `131072`
- `EXPORT_BRIDGE_FILE_MAX_AGE_MS` — default `21600000`
- `EXPORT_BRIDGE_TEMP_DIR` — defaults to the operating-system temporary directory
- `EXPORT_BUFFER_BRIDGE_DISABLED=1` — emergency disable switch

## Operational result

The remaining legacy export routes no longer need to be rewritten all at once to receive memory protection. New or touched routes should still prefer explicit helpers, but old routes are protected centrally until they are naturally refactored.
