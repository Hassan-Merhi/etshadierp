---
name: Export bridge write(stream) bug
description: exportBufferBridge.mjs was intercepting writeBuffer() and rerouting through write(stream), the broken ExcelJS 3.x API, producing 0-byte corrupt xlsx downloads.
---

## Rule
`exportBufferBridge.mjs` must call `originalWriteBuffer()` to get the in-memory buffer, then optionally flush to a temp file for large workbooks. It must NEVER call `originalWrite(stream)` — that is the ExcelJS 3.x broken streaming API.

## Why
ExcelJS 3.x `write(stream)` throws `"ea.results is not a Promise"` in some cases and produces 0-byte or corrupt output silently in others (especially workbooks with shared formulas). The bridge was intercepting all `writeBuffer()` calls and redirecting them through `write(stream)`, making every Excel download on the site broken (shows as 0 B or "file format not valid" in Excel).

## How to apply
If `exportBufferBridge.mjs` is ever edited: the `bridgedWriteBuffer` function must call `await originalWriteBuffer.call(this, options)` to produce the buffer, then write that buffer to a temp file with a `createWriteStream` if it exceeds `chunkBridgeThreshold`. Never use `originalWrite` for workbook serialization.

## Secondary fix (same session)
`compression()` middleware was gzip-compressing xlsx/pdf/zip responses while routes had already set `Content-Length` to the uncompressed size. Browser saw the mismatch and discarded the response. Fix: configure compression filter in `server/index.ts` to skip `spreadsheet|zip|pdf|octet-stream|image/` content types.
