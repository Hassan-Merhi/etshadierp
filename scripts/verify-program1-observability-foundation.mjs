import fs from "node:fs";

const requiredFiles = [
  "server/lib/logger.ts",
  "server/lib/traceContext.ts",
  "server/lib/observabilityBootstrap.ts",
  "server/lib/requestPerformanceContext.ts",
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
  [bootstrap.includes("cronAny.schedule"), "cron callbacks must be wrapped centrally"],
  [requestLogger.includes("X-Request-Id"), "request logger must return a correlation ID"],
  [requestLogger.includes("(req as any).requestId = requestId"), "request ID must be available downstream"],
  [requestLogger.includes("runWithTraceContext"), "every HTTP request must create a trace context"],
  [requestLogger.includes("runWithRequestPerformanceContext"), "database timing must be active for every request"],
  [requestLogger.includes("normaliseRouteTemplate"), "HTTP logs must use route templates"],
  [requestLogger.includes("dbQueryCount"), "request metrics must include database query counts"],
  [requestLogger.includes("handleClientObservability"), "browser intake must be mounted in the authenticated path"],
  [requestLogger.includes("/api/health/metrics"), "monitoring metrics endpoint must remain available"],
  [requestLogger.includes("isMonitoringRole"), "metrics endpoint must remain role restricted"],
  [requestLogger.includes("recordOperationalEvent"), "HTTP failures must feed operational events"],
  [wsServer.includes("source: \"websocket\""), "WebSocket work must receive trace context"],
  [wsServer.includes("websocket-broadcast-${randomUUID()}"), "WebSocket broadcasts must receive correlation IDs"],
  [intake.includes('const ENDPOINT = "/api/auth/observability/client-error"'), "browser intake must remain authenticated"],
  [intake.includes("Authentication required"), "browser intake must reject unauthenticated requests"],
  [intake.includes("CLIENT_ERROR_RATE_LIMIT"), "server intake must remain rate limited"],
  [intake.includes("CLIENT_ERROR_DEDUPE_MS"), "server intake must deduplicate repeated failures"],
  [intake.includes("OBSERVABILITY_WEBHOOK_URL"), "external delivery must remain optional"],
  [intake.includes("External observability delivery failed"), "external delivery must fail open"],
  [index.includes('process.on("unhandledRejection"'), "server must capture unhandled rejections"],
  [index.includes('process.on("uncaughtException"'), "server must capture uncaught exceptions"],
  [clientMain.includes("installClientObservability()"), "client capture must be installed before rendering"],
  [clientMain.includes("<ObservabilityErrorBoundary>"), "React tree must use the observability boundary"],
  [clientCapture.includes('window.addEventListener("error"'), "window errors must be captured"],
  [clientCapture.includes('window.addEventListener("unhandledrejection"'), "promise rejections must be captured"],
  [clientCapture.includes('headers.set("X-Request-Id"'), "browser API calls must carry correlation IDs"],
  [errorBoundary.includes("componentDidCatch"), "React render failures must be reported"],
  [roadmap.includes("Phase 1 — Centralized error capture and correlation"), "Phase 1 must remain documented"],
  [roadmap.includes("Phase 2 — Structured tracing and dependency timing"), "Phase 2 must remain documented"],
  [roadmap.includes("Status: complete"), "completed observability phases must remain marked complete"],
  [roadmap.includes("Never send request bodies"), "payload privacy boundary must remain documented"],
  [roadmap.includes("Monitoring dependencies must fail open"), "fail-open behavior must remain documented"],
];

for (const [passed, message] of checks) {
  if (!passed) throw new Error(`Program 1 observability verification failed: ${message}`);
}

console.log("Program 1 observability Phase 1 and Phase 2 contract verified.");
