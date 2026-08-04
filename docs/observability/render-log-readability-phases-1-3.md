# Render Log Readability — Phases 1–3

## Scope

This document records the production-log audit and the logging standard introduced for Render. The goal is to keep logs useful for technical diagnosis while making the first part of every line understandable without manually decoding JSON.

## Phase 1 — Audit and classification

The production sample from 4 August 2026 exposed the following recurring classes.

| Category | Examples found | Required production treatment |
| --- | --- | --- |
| Business activity | POS sale updates, container tracking updates, invoice generation | Readable `INFO` sentence with stable event name and business identifier |
| External integration | Green API uploads and WhatsApp PDF sending | Readable success/failure sentence; technical response remains structured context |
| HTTP monitoring | Slow requests, 4xx and 5xx responses | One request-completion entry from the Express request logger |
| Bandwidth | Large responses and five-minute endpoint rankings | Readable summary message with detailed metrics retained as context |
| Inventory/reference data | Location inventory row counts | Readable sentence; later noise-control work may move routine entries to `DEBUG` |
| Authentication/security | Missing sessions and denied access | Plain explanation of the denial reason without embedded JSON text |
| Runtime health | Event-loop pressure, memory pressure, startup thresholds | Readable warning or startup sentence |
| Debug lifecycle | `started` immediately followed by `succeeded` | Kept compatible in phases 1–3; phase 4 removes unnecessary start entries |

### Audit findings

1. Render displayed application JSON after its own timestamp, so every line contained two timestamps and required manual field reading.
2. Runtime observability and Express request logging both reported the same slow request. Runtime request-event emission is now disabled by default; the Express request logger is authoritative.
3. Several messages embedded implementation syntax such as `[getLocationInventory]`, `[WA invoice backend]`, route names and arrow symbols.
4. The WhatsApp integration logged a generic `Green API response` instead of saying what succeeded.
5. The bandwidth ranking contained useful structured metrics but its message did not summarize the amount of traffic or reporting window.
6. Existing callers already use `server/lib/logger.ts` extensively, so central compatibility translation is safer than rewriting every call in one deployment.

Run the repeatable source audit with:

```bash
node scripts/audit-production-logs.mjs
node scripts/audit-production-logs.mjs --json
```

## Phase 2 — Shared logging service

`server/lib/logger.ts` is the single application logging entry point.

The shared logger now provides:

- `LOG_LEVEL=debug|info|warn|error`
- `LOG_FORMAT=pretty|json`
- automatic readable output on Render
- automatic JSON output in non-Render production environments
- stable `event` derivation from `module` and `action`
- `createScopedLogger()` for new modules
- context sanitisation and bounded serialization
- a global bridge used by the early runtime-observability bootstrap

### New-call standard

```ts
const log = createScopedLogger("pos");

log.info("sale_updated", "POS sale 11877 was updated successfully.", {
  voucherId: 11877,
  durationMs: 251,
});
```

The resulting Render line is designed to begin with the sentence:

```text
[INFO] POS sale 11877 was updated successfully. event=pos.sale_updated voucherId=11877 durationMs=251 ms
```

For external log shipping, set `LOG_FORMAT=json`; the same sentence and all structured fields remain available.

## Phase 3 — Plain-language compatibility layer

The central logger converts the main legacy patterns before output. Supported conversions include:

- location inventory row-count messages
- POS sale update lifecycle messages
- container tracking lifecycle messages
- WhatsApp/Green API upload results
- POS invoice and stock-report PDF generation
- HTTP request completion messages
- large-response warnings
- five-minute bandwidth summaries
- embedded `access_denied` JSON messages
- bracket-prefixed technical messages

This means existing modules become readable immediately while they are gradually migrated to `createScopedLogger()`.

## Render behavior

On Render, no environment change is required for readable output because `RENDER=true` or `RENDER_SERVICE_ID` selects `pretty` format automatically.

Optional overrides:

```env
LOG_LEVEL=info
LOG_FORMAT=pretty
RUNTIME_OBSERVABILITY_REQUEST_LOGS=false
```

Use `LOG_FORMAT=json` when streaming logs to a structured observability provider.

## Completion criteria

Phases 1–3 are complete when:

- the audit is reproducible from source;
- the server has one shared logger contract;
- Render defaults to readable lines;
- legacy messages in the production sample are translated into sentences;
- request-level runtime duplicates are disabled by default;
- technical identifiers remain available as structured or key/value context;
- unit and static verification cover the compatibility behavior.

## Deferred to later phases

The following are intentionally not part of phases 1–3:

- moving all routine inventory/polling entries to `DEBUG`;
- removing every start/success pair;
- reducing the detailed bandwidth arrays to a top-three summary;
- endpoint-specific slow-request thresholds;
- expanded phone, chat-ID and temporary-URL redaction;
- the ERP administrator activity-log user interface;
- external alerting and retention configuration.
