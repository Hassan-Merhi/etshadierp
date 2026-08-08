# Render Log Readability — Phases 1–5

## Scope

This document records the production-log audit and logging standard introduced for Render. The goal is to keep logs technically useful while making normal production output readable, concise and focused on activity that needs attention.

## Phase 1 — Audit and classification

The production sample from 4 August 2026 exposed recurring business, integration, HTTP, bandwidth, inventory, security, runtime-health and debug-lifecycle messages.

The repeatable source audit is:

```bash
node scripts/audit-production-logs.mjs
node scripts/audit-production-logs.mjs --json
```

The audit identified duplicate slow-request entries, repeated location-inventory reads, start/success pairs, implementation-oriented bracket prefixes, generic Green API responses and large five-minute endpoint arrays.

## Phase 2 — Shared logging service

`server/lib/logger.ts` is the single application logging entry point.

The shared logger provides:

- `LOG_LEVEL=debug|info|warn|error`;
- `LOG_FORMAT=pretty|json`;
- automatic readable output on Render;
- structured JSON for external log shipping;
- stable event names;
- scoped module logging;
- bounded context serialization;
- a bootstrap bridge for runtime observability.

Render defaults to `LOG_LEVEL=info` and readable `pretty` output unless explicitly overridden.

## Phase 3 — Plain-language compatibility layer

The central logger converts the main legacy patterns into readable sentences, including inventory counts, POS and container lifecycle results, WhatsApp uploads, document generation, HTTP outcomes, bandwidth summaries, large-response warnings and access-denied events.

Technical identifiers remain available as structured context or key/value fields.

## Phase 4 — Remove duplicate and noisy logs

Production `INFO` output now represents completed business activity rather than every internal step.

The central noise policy moves the following to `DEBUG`:

- operation messages ending in `started`, `starting` or equivalent lifecycle actions;
- repeated `[getLocationInventory]` row-count entries;
- polling, heartbeat and keepalive activity;
- cache hits/misses and routine query lifecycle messages;
- routine auth/session checks and expected `/api/auth/me` unauthenticated checks;
- technical POS, stock-transfer, inventory, cache, query, auth and session detail lines;
- the legacy Express `[SLOW API]` line when the shared request logger already records the request.

Completion, warning and failure messages remain visible. Setting `LOG_LEVEL=debug` restores the routine diagnostic detail when it is needed.

### Phase 4 completion criteria

Phase 4 is complete when normal ERP navigation no longer floods Render with repeated inventory reads, polling messages, expected auth checks or start events, and one operation produces one visible completion result at normal production verbosity.

## Phase 5 — Improve performance and bandwidth logging

### Endpoint-aware slow-request thresholds

Slow warnings now use the endpoint type instead of one global 500 ms threshold.

| Endpoint class | Default threshold |
| --- | ---: |
| Normal API | 1,000 ms |
| PDF/print/receipt generation | 3,000 ms |
| WhatsApp/Green API document delivery | 5,000 ms |
| Report/statement Excel, CSV or download export | 5,000 ms |
| Background job, reconciliation, repair, migration or bulk sync | 10,000 ms |

The old `SLOW_REQUEST_MS` setting remains a compatibility override for the normal API class. Dedicated overrides are:

```env
SLOW_REQUEST_DEFAULT_MS=1000
SLOW_REQUEST_PDF_MS=3000
SLOW_REQUEST_WHATSAPP_MS=5000
SLOW_REQUEST_REPORT_EXPORT_MS=5000
SLOW_REQUEST_BACKGROUND_JOB_MS=10000
```

Each slow warning includes its threshold and timing class so a normal 1–3 second PDF or WhatsApp operation is not incorrectly presented as a performance problem.

### Concise bandwidth reporting

The five-minute Render message includes total API traffic and only the top three endpoints by transferred bytes. `BANDWIDTH_DEBUG_LOG_TOP_N` may increase this to a maximum of five.

The complete current-window ranking remains available to Admin and Developer users through:

```text
GET /api/health/metrics
```

under the `bandwidth` field. The snapshot includes every API and static-asset row, totals, budgets, violations and generation time.

Empty non-API reporting windows no longer produce a meaningless bandwidth message.

### Large-response thresholds

Large-response warnings are endpoint-aware:

| Response type | Default warning threshold |
| --- | ---: |
| Normal API response | 500 KB |
| Hashed static asset | 2 MB |
| PDF, WhatsApp document or export | 10 MB |

Overrides are:

```env
BANDWIDTH_DEBUG_THRESHOLD_KB=500
BANDWIDTH_DEBUG_STATIC_THRESHOLD_KB=2048
BANDWIDTH_DEBUG_DOCUMENT_THRESHOLD_KB=10240
BANDWIDTH_DEBUG_LOG_TOP_N=3
```

### Phase 5 completion criteria

Phase 5 is complete when Render bandwidth lines are concise, full rankings remain accessible in protected diagnostics, and slow/large-response warnings represent genuinely unusual behavior rather than normal document generation, exports or WhatsApp delivery.

## Verification

The implementation is covered by:

- logger readability and noise-policy tests;
- request timing-class and threshold tests;
- bandwidth response-threshold tests;
- a static phases 1–5 contract verifier;
- repository TypeScript, build, lint and test workflows.

## Deferred to later phases

The following remain outside phases 1–5:

- expanded phone, chat-ID and temporary-URL redaction;
- an ERP administrator activity-log user interface;
- external log retention, streaming and alert-provider configuration.
