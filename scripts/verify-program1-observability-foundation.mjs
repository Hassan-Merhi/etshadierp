import fs from "node:fs";

const requiredFiles = [
  "server/lib/logger.ts",
  "server/lib/traceContext.ts",
  "server/lib/observabilityBootstrap.ts",
  "server/lib/requestPerformanceContext.ts",
  "server/lib/performanceDashboard.ts",
  "server/lib/runtimePerformance.ts",
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
];

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) throw new Error(`Program 1 missing required file: ${file}`);
}

const logger = fs.readFileSync("server/lib/logger.ts", "utf8");
const trace = fs.readFileSync("server/lib/traceContext.ts", "utf8");
const bootstrap = fs.readFileSync("server/lib/observabilityBootstrap.ts", "utf8");
const dashboard = fs.readFileSync("server/lib/performanceDashboard.ts", "utf8");
const runtime = fs.readFileSync("server/lib/runtimePerformance.ts", "utf8");
const requestLogger = fs.readFileSync("server/middleware/requestLogger.ts", "utf8");
const intake = fs.readFileSync("server/middleware/clientObservability.ts", "utf8");
const wsServer = fs.readFileSync("server/wsServer.ts", "utf8");
const index = fs.readFileSync("server/index.ts", "utf8");
const clientMain = fs.readFileSync("client/src/main.tsx", "utf8");
const clientCapture = fs.readFileSync("client/src/lib/clientObservability.ts", "utf8");
const errorBoundary = fs.readFileSync("client/src/components/ObservabilityErrorBoundary.tsx", "utf8");
const roadmap = fs.readFileSync("docs/program-1-observability-roadmap.md", "utf8");

const checks = [
  [logger.includes("SENSITIVE_KEY_PATTERN"), "server logger must redact sensitive keys"],
  [logger.includes("JSON.stringify(entry)"), "production logger must emit structured JSON"],
  [logger.includes("getTraceContext"), "logger must inherit active trace context"],
  [trace.includes("AsyncLocalStorage"), "trace context must be concurrency safe"],
  [trace.includes("normaliseRouteTemplate"), "trace context must normalize route identifiers"],
  [trace.includes("withTraceSpan"), "safe dependency span helper must remain available"],
  [bootstrap.includes("api.green-api.com"), "Green API dependency calls must be traced"],
  [bootstrap.includes("maersk"), "carrier dependency tracing must remain available"],
  [bootstrap.includes("EXTERNAL_DEPENDENCY_SLOW_MS"), "external dependency slow threshold must be configurable"],
  [bootstrap.includes("scheduler-${randomUUID()}"), "scheduled jobs must receive correlation IDs"],
  [bootstrap.includes("recordRuntimePerformance"), "dependency and scheduler spans must feed the Phase 3 runtime window"],
  [requestLogger.includes("X-Request-Id"), "request logger must return a correlation ID"],
  [requestLogger.includes("runWithTraceContext"), "every HTTP request must create a trace context"],
  [requestLogger.includes("recordPerformanceSample"), "HTTP requests must feed the bounded performance dashboard"],
  [requestLogger.includes("responseBytes"), "dashboard samples must include response size"],
  [dashboard.includes("PERFORMANCE_DASHBOARD_MAX_SAMPLES"), "HTTP dashboard retention must be bounded"],
  [dashboard.includes("p50Ms") && dashboard.includes("p95Ms") && dashboard.includes("p99Ms"), "dashboard must expose latency percentiles"],
  [dashboard.includes('"Supplier Partner"') && dashboard.includes('"Properties"') && dashboard.includes('"POS"'), "dashboard must separate application modes"],
  [dashboard.includes("/api/health/performance.json"), "dashboard JSON endpoint must remain available"],
  [dashboard.includes("Admin or Developer access required"), "performance dashboard must remain role restricted"],
  [dashboard.includes("getRuntimePerformanceSnapshot"), "dashboard must include background and dependency aggregates"],
  [runtime.includes("PERFORMANCE_DASHBOARD_RUNTIME_MAX_SAMPLES"), "runtime performance retention must be bounded"],
  [runtime.includes("backgroundJobs") && runtime.includes("dependencies"), "runtime snapshot must separate jobs and dependencies"],
  [wsServer.includes('source: "websocket"'), "WebSocket work must receive trace context"],
  [intake.includes('const ENDPOINT = "/api/auth/observability/client-error"'), "browser intake must remain authenticated"],
  [intake.includes("CLIENT_ERROR_RATE_LIMIT"), "server intake must remain rate limited"],
  [intake.includes("CLIENT_ERROR_DEDUPE_MS"), "server intake must deduplicate repeated failures"],
  [intake.includes("OBSERVABILITY_WEBHOOK_URL"), "external delivery must remain optional"],
  [index.includes('process.on("unhandledRejection"'), "server must capture unhandled rejections"],
  [index.includes('process.on("uncaughtException"'), "server must capture uncaught exceptions"],
  [clientMain.includes("installClientObservability()"), "client capture must be installed before rendering"],
  [clientMain.includes("<ObservabilityErrorBoundary>"), "React tree must use the observability boundary"],
  [clientCapture.includes('window.addEventListener("error"'), "window errors must be captured"],
  [clientCapture.includes('window.addEventListener("unhandledrejection"'), "promise rejections must be captured"],
  [errorBoundary.includes("componentDidCatch"), "React render failures must be reported"],
  [roadmap.includes("Phase 3 — Performance dashboards"), "Phase 3 must remain documented"],
  [roadmap.includes("Status: complete"), "completed observability phases must remain marked complete"],
  [roadmap.includes("Never send request bodies"), "payload privacy boundary must remain documented"],
  [roadmap.includes("Monitoring dependencies must fail open"), "fail-open behavior must remain documented"],
];

for (const [passed, message] of checks) {
  if (!passed) throw new Error(`Program 1 observability verification failed: ${message}`);
}

console.log("Program 1 observability Phases 1-3 contract verified.");
