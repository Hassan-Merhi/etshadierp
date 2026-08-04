# Render production logging

Use these environment variables on the Render web service:

```env
NODE_ENV=production
LOG_LEVEL=info
LOG_FORMAT=pretty
LOG_REDACT_SENSITIVE=true
REQUEST_LOG_SAMPLE_RATE=0
RUNTIME_OBSERVABILITY_REQUEST_LOGS=false
BANDWIDTH_DEBUG=true
BANDWIDTH_DEBUG_REPORT_INTERVAL_MS=300000
BANDWIDTH_DEBUG_LOG_TOP_N=3
```

`LOG_FORMAT=pretty` gives readable sentences in the Render dashboard. Use `json` only when a downstream log provider needs structured JSON.

Production always keeps sensitive-value redaction active. It removes or masks tokens, authorization values, cookies, credentials, signed query parameters, private upload links, WhatsApp chat IDs, phone fields, email fields, connection strings and secrets embedded in error text.

Every HTTP response includes `X-Request-Id`. The same request ID, user/company/location context and Render build version are propagated through the trace context into application logs.

Normal production output should use `LOG_LEVEL=info`. Enable `debug` only temporarily while diagnosing a specific problem, then return it to `info`.
