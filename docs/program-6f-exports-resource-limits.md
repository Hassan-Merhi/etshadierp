# Program 6F — Exports and Resource Limits

Branch: `integration/programs-1-to-6-validation`

## Objective

Prevent exports, PDF/ZIP generation, Puppeteer jobs, and other memory-heavy operations from exhausting the Node process while preserving generated file contents and existing business behavior.

## Completed controls

### Heavy export coordination

`server/exportBufferBridge.mjs` provides a process-wide export coordinator:

- default maximum concurrent heavy exports: 1
- bounded waiting queue
- configurable queue wait timeout
- nested export calls reuse the active slot instead of deadlocking
- excess requests fail safely instead of accumulating unbounded work

Configuration:

- `HEAVY_EXPORT_MAX_CONCURRENT`
- `HEAVY_EXPORT_MAX_QUEUE`
- `HEAVY_EXPORT_WAIT_TIMEOUT_MS`

### Workbook delivery

Legacy `ExcelJS.xlsx.writeBuffer()` browser downloads are intercepted without changing individual export routes.

For browser downloads, the bridge:

1. writes the workbook to a uniquely named temporary file;
2. returns a lightweight marker rather than one large in-memory buffer;
3. streams the file to the HTTP response;
4. respects response backpressure;
5. removes the temporary file after finish, disconnect, or error;
6. removes stale files left by interrupted processes at startup.

Email, scheduled-delivery, WhatsApp, and attachment workflows remain excluded because their downstream APIs require attachment buffers.

### PDF and ZIP response buffering

Application-owned `Buffer.concat()` calls used for browser PDF/ZIP downloads are bridged into chunked response delivery above the configured threshold. The response bridge releases retained chunks after finish, close, or error.

### Runtime memory protection

`server/runtimeMemoryGuard.mjs` is preloaded in production and provides:

- soft and hard RSS thresholds;
- periodic and per-request memory sampling;
- explicit external and ArrayBuffer memory reporting;
- rejection of new API work during critical pressure;
- endpoint concurrency limits for known heavy operations;
- garbage-collection requests when available;
- controlled process restart after sustained hard-limit pressure.

Health endpoints remain available during pressure and shutdown so the hosting platform can make correct lifecycle decisions.

### Puppeteer control

`server/lib/puppeteerSemaphore.ts` provides one process-wide browser-operation gate used by the Maersk and ParcelsApp scrapers.

The gate now includes:

- configurable concurrent-operation limit;
- bounded queue depth;
- configurable queue wait timeout;
- immediate `PUPPETEER_QUEUE_FULL` failure when saturated;
- `PUPPETEER_QUEUE_TIMEOUT` failure when a stalled job blocks the queue;
- idempotent slot release.

Configuration:

- `PUPPETEER_MAX_CONCURRENT`
- `PUPPETEER_MAX_QUEUE_DEPTH`
- `PUPPETEER_QUEUE_WAIT_TIMEOUT_MS`

### Audit and regression protection

- `scripts/audit-large-export-buffers.mjs` inventories workbook buffers, response buffers, PDF chunk arrays, and archive buffering.
- Strict mode is available through `EXPORT_BUFFER_AUDIT_FAIL=1`.
- `scripts/verify-program6f-export-resource-controls.mjs` protects preload wiring, concurrency limits, queue limits, timeouts, backpressure, cleanup, memory-pressure behavior, and Puppeteer fail-safe behavior.

## Preserved behavior

Program 6F does not change:

- accounting totals or reconciliation;
- inventory quantities, rates, values, or costing;
- workbook, PDF, or ZIP contents;
- company isolation or authorization;
- email or scheduled attachment contracts;
- historical records.

## Operational defaults

The defaults favor stability on a memory-constrained single-process host:

- one active heavy export;
- one active Puppeteer operation;
- six queued requests for each gate;
- finite queue wait times;
- automatic cleanup of interrupted temporary files.

Deployments with larger memory allocations may raise the environment limits deliberately after observing memory usage.

## Completion status

Phase 6F is implementation-complete. No merge, deployment, production migration, or production-data modification is included in this phase.
