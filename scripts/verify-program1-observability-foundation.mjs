import fs from "node:fs";

const requiredFiles = [
  "server/lib/logger.ts",
  "server/lib/traceContext.ts",
  "server/lib/observabilityBootstrap.ts",
  "server/lib/requestPerformanceContext.ts",
  "server/lib/performanceDashboard.ts",
  "server/lib/runtimePerformance.ts",
  "server/lib/operationalAlerts.ts",
  "server/lib/operationalAlertRuntime.ts",
  "server/middleware/requestLogger.ts",
  "server/middleware/activityAudit.ts",
  "server/middleware/clientObservability.ts",
  "server/lib/operationalEvents.ts",
  "server/middleware/bandwidthDebug.ts",
  "server/wsServer.ts",
  "server/index.ts",
  "client/src/main.tsx",
  "client/src/lib/clientObservability.ts",
  "client/src/components/ObservabilityErrorBoundary.tsx",
  "docs/program-1-observability-roadmap.md",
  "docs/program-1-incident-response-runbook.md",
];
for (const file of requiredFiles) if (!fs.existsSync(file)) throw new Error(`Program 1 missing required file: ${file}`);

const read = (file) => fs.readFileSync(file, "utf8");
const logger = read("server/lib/logger.ts");
const trace = read("server/lib/traceContext.ts");
const bootstrap = read("server/lib/observabilityBootstrap.ts");
const dashboard = read("server/lib/performanceDashboard.ts");
const runtime = read("server/lib/runtimePerformance.ts");
const alerts = read("server/lib/operationalAlerts.ts");
const alertRuntime = read("server/lib/operationalAlertRuntime.ts");
const requestLogger = read("server/middleware/requestLogger.ts");
const intake = read("server/middleware/clientObservability.ts");
const wsServer = read("server/wsServer.ts");
const index = read("server/index.ts");
const clientMain = read("client/src/main.tsx");
const clientCapture = read("client/src/lib/clientObservability.ts");
const errorBoundary = read("client/src/components/ObservabilityErrorBoundary.tsx");
const roadmap = read("docs/program-1-observability-roadmap.md");
const runbook = read("docs/program-1-incident-response-runbook.md");

const checks = [
  [logger.includes("SENSITIVE_KEY_PATTERN"), "server logger must redact sensitive keys"],
  [logger.includes("JSON.stringify(entry)"), "production logger must emit structured JSON"],
  [logger.includes("getTraceContext"), "logger must inherit active trace context"],
  [trace.includes("AsyncLocalStorage"), "trace context must be concurrency safe"],
  [trace.includes("normaliseRouteTemplate"), "trace context must normalize route identifiers"],
  [trace.includes("withTraceSpan"), "safe dependency span helper must remain available"],
  [bootstrap.includes("api.green-api.com") && bootstrap.includes("maersk"), "supported external dependencies must be traced"],
  [bootstrap.includes("scheduler-${randomUUID()}"), "scheduled jobs must receive correlation IDs"],
  [bootstrap.includes("recordRuntimePerformance"), "dependency and scheduler spans must feed the runtime window"],
  [bootstrap.includes("installOperationalAlertRuntime"), "operational alert evaluation must be installed"],
  [requestLogger.includes("X-Request-Id"), "request logger must return a correlation ID"],
  [requestLogger.includes("recordPerformanceSample") && requestLogger.includes("responseBytes"), "HTTP requests must feed bounded performance samples"],
  [dashboard.includes("PERFORMANCE_DASHBOARD_MAX_SAMPLES"), "HTTP dashboard retention must be bounded"],
  [dashboard.includes("p50Ms") && dashboard.includes("p95Ms") && dashboard.includes("p99Ms"), "dashboard must expose latency percentiles"],
  [dashboard.includes('"Supplier Partner"') && dashboard.includes('"Properties"') && dashboard.includes('"POS"'), "dashboard must separate application modes"],
  [dashboard.includes("/api/health/performance.json"), "dashboard JSON endpoint must remain available"],
  [dashboard.includes("/api/health/incidents.json"), "incident JSON endpoint must remain available"],
  [dashboard.includes("Admin or Developer access required"), "monitoring dashboards must remain role restricted"],
  [dashboard.includes("getRuntimePerformanceSnapshot"), "dashboard must include background and dependency aggregates"],
  [runtime.includes("PERFORMANCE_DASHBOARD_RUNTIME_MAX_SAMPLES"), "runtime performance retention must be bounded"],
  [runtime.includes("backgroundJobs") && runtime.includes("dependencies"), "runtime snapshot must separate jobs and dependencies"],
  [alerts.includes("OBSERVABILITY_ALERT_COOLDOWN_MS"), "alerts must implement configurable cooldown"],
  [alerts.includes("OBSERVABILITY_ALERT_HISTORY_LIMIT"), "resolved incident history must be bounded"],
  [alerts.includes("OBSERVABILITY_ALERT_5XX_PERCENT") && alerts.includes("OBSERVABILITY_ALERT_P95_MS"), "HTTP alert thresholds must be configurable"],
  [alerts.includes("OBSERVABILITY_ALERT_RSS_MB") && alerts.includes("OBSERVABILITY_ALERT_DB_WAITING"), "resource alert thresholds must be configurable"],
  [alerts.includes("OBSERVABILITY_ALERT_JOB_FAILURES") && alerts.includes("OBSERVABILITY_ALERT_DEPENDENCY_FAILURES"), "job and dependency failure thresholds must be configurable"],
  [alerts.includes("OBSERVABILITY_ALERT_WEBHOOK_URL") && alerts.includes("AbortSignal.timeout"), "alert delivery must be optional and bounded"],
  [alerts.includes("Operational alert delivery failed"), "alert delivery must fail open"],
  [alertRuntime.includes('OBSERVABILITY_ALERTS_ENABLED !== "true"'), "alert evaluation must be disabled by default"],
  [alertRuntime.includes("setInterval") && alertRuntime.includes("unref"), "alert evaluation must be periodic without holding shutdown open"],
  [wsServer.includes('source: "websocket"'), "WebSocket work must receive trace context"],
  [intake.includes("CLIENT_ERROR_RATE_LIMIT") && intake.includes("CLIENT_ERROR_DEDUPE_MS"), "browser intake must be rate limited and deduplicated"],
  [intake.includes("OBSERVABILITY_WEBHOOK_URL"), "browser error delivery must remain optional"],
  [index.includes('process.on("unhandledRejection"') && index.includes('process.on("uncaughtException"'), "server process failures must be captured"],
  [clientMain.includes("installClientObservability()") && clientMain.includes("<ObservabilityErrorBoundary>"), "client observability must remain installed"],
  [clientCapture.includes('window.addEventListener("error"') && clientCapture.includes('window.addEventListener("unhandledrejection"'), "browser failures must be captured"],
  [errorBoundary.includes("componentDidCatch"), "React render failures must be reported"],
  [roadmap.includes("Phase 4 — Alerts and operational response") && roadmap.includes("Program status: complete"), "Program 1 must be documented as complete"],
  [runbook.includes("Triage") && runbook.includes("Recovery verification"), "incident runbook must cover triage and recovery"],
  [roadmap.includes("Never send request bodies"), "payload privacy boundary must remain documented"],
  [roadmap.includes("Monitoring dependencies must fail open"), "fail-open behavior must remain documented"],
];
for (const [passed, message] of checks) if (!passed) throw new Error(`Program 1 observability verification failed: ${message}`);
console.log("Program 1 observability Phases 1-4 contract verified.");
