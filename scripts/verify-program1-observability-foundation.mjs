import fs from "node:fs";

const requiredFiles = [
  "server/lib/logger.ts",
  "server/middleware/requestLogger.ts",
  "server/middleware/clientObservability.ts",
  "server/lib/operationalEvents.ts",
  "server/middleware/bandwidthDebug.ts",
  "server/index.ts",
  "client/src/main.tsx",
  "client/src/lib/clientObservability.ts",
  "client/src/components/ObservabilityErrorBoundary.tsx",
  "docs/program-1-observability-roadmap.md",
];

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) {
    throw new Error(`Program 1 Phase 1 missing required file: ${file}`);
  }
}

const logger = fs.readFileSync("server/lib/logger.ts", "utf8");
const requestLogger = fs.readFileSync("server/middleware/requestLogger.ts", "utf8");
const intake = fs.readFileSync("server/middleware/clientObservability.ts", "utf8");
const index = fs.readFileSync("server/index.ts", "utf8");
const clientMain = fs.readFileSync("client/src/main.tsx", "utf8");
const clientCapture = fs.readFileSync("client/src/lib/clientObservability.ts", "utf8");
const errorBoundary = fs.readFileSync("client/src/components/ObservabilityErrorBoundary.tsx", "utf8");
const roadmap = fs.readFileSync("docs/program-1-observability-roadmap.md", "utf8");

const checks = [
  [logger.includes("SENSITIVE_KEY_PATTERN"), "server logger must redact sensitive keys"],
  [logger.includes("JSON.stringify(entry)"), "production logger must emit structured JSON"],
  [requestLogger.includes("X-Request-Id"), "request logger must return a correlation ID"],
  [requestLogger.includes("(req as any).requestId = requestId"), "request ID must be available to downstream handlers"],
  [requestLogger.includes("handleClientObservability"), "browser intake must be mounted in the authenticated middleware path"],
  [requestLogger.includes("/api/health/metrics"), "monitoring metrics endpoint must remain available"],
  [requestLogger.includes("isMonitoringRole"), "metrics endpoint must remain role restricted"],
  [requestLogger.includes("recordOperationalEvent"), "HTTP failures must feed operational events"],
  [intake.includes('const ENDPOINT = "/api/observability/client-error"'), "browser intake endpoint must remain stable"],
  [intake.includes("Authentication required"), "browser intake must reject unauthenticated requests"],
  [intake.includes("CLIENT_ERROR_RATE_LIMIT"), "server intake must remain rate limited"],
  [intake.includes("CLIENT_ERROR_DEDUPE_MS"), "server intake must deduplicate repeated failures"],
  [intake.includes("OBSERVABILITY_WEBHOOK_URL"), "external delivery must remain optional"],
  [intake.includes("External observability delivery failed"), "external delivery must fail open"],
  [index.includes('process.on("unhandledRejection"'), "server must capture unhandled rejections"],
  [index.includes('process.on("uncaughtException"'), "server must capture uncaught exceptions"],
  [clientMain.includes("installClientObservability()"), "client capture must be installed before rendering"],
  [clientMain.includes("<ObservabilityErrorBoundary>"), "React tree must be protected by the observability boundary"],
  [clientCapture.includes('window.addEventListener("error"'), "window errors must be captured"],
  [clientCapture.includes('window.addEventListener("unhandledrejection"'), "non-chunk promise rejections must be captured"],
  [clientCapture.includes('headers.set("X-Request-Id"'), "browser API calls must carry correlation IDs"],
  [clientCapture.includes("RATE_LIMIT = 10"), "browser reporting must remain bounded"],
  [clientCapture.includes("DEDUPE_WINDOW_MS"), "browser reporting must deduplicate repeats"],
  [errorBoundary.includes("componentDidCatch"), "React render failures must be reported"],
  [roadmap.includes("Status: complete"), "Phase 1 roadmap status must be complete"],
  [roadmap.includes("Never send request bodies"), "payload privacy boundary must remain documented"],
  [roadmap.includes("Monitoring dependencies must fail open"), "fail-open behavior must remain documented"],
];

for (const [passed, message] of checks) {
  if (!passed) throw new Error(`Program 1 Phase 1 verification failed: ${message}`);
}

console.log("Program 1 Phase 1 observability contract verified.");
