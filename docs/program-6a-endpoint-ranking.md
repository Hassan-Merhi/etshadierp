# Program 6A — Endpoint Measurement and Ranking

## Status

Implementation complete on `integration/programs-1-to-6-validation`.

## What is measured

When `BANDWIDTH_DEBUG=true`, every HTTP request is grouped by normalized route and measured for:

- request count and server-error count;
- total, average, and maximum response bytes;
- average and maximum request duration;
- average and maximum process heap delta;
- PostgreSQL query count and total query duration attributed to the active request.

The profiler never records response bodies, request bodies, SQL text, query parameters, cookies, authorization headers, tokens, or record identifiers.

## Output

A ranked `endpoint_performance_ranking` operational event is emitted at the configured interval. The default interval is five minutes and the default result size is the top 20 endpoints.

Configuration:

- `BANDWIDTH_DEBUG=true`
- `BANDWIDTH_DEBUG_THRESHOLD_KB=500`
- `BANDWIDTH_DEBUG_REPORT_INTERVAL_MS=300000`
- `BANDWIDTH_DEBUG_TOP_N=20`

Large individual responses continue to emit `large_http_response` events.

## Ranking inputs

The score combines total bandwidth, request frequency, average latency, positive heap growth, average database duration, server errors, and peak response size. It is intended to prioritize investigation, not to replace query-plan analysis.

## Safety

- Entire profiler remains opt-in.
- No API response shape changes.
- No database writes or migrations.
- No accounting, inventory, costing, or historical-data behavior changes.
- Database timing overhead is skipped unless a profiled request context is active.

## Regression coverage

`tests/program-6a-endpoint-ranking.test.ts` verifies request-context isolation and multi-factor ranking behavior.
