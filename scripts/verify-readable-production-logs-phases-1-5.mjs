import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const failures = [];

function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) {
    failures.push(`${relativePath} is missing`);
    return "";
  }
  return fs.readFileSync(absolute, "utf8");
}

function requireText(source, expected, description) {
  if (!source.includes(expected)) failures.push(description);
}

const logger = read("server/lib/logger.ts");
const loggerTests = read("server/lib/logger.test.ts");
const requestPolicy = read("server/lib/requestLoggingPolicy.ts");
const requestPolicyTests = read("server/lib/requestLoggingPolicy.test.ts");
const requestLogger = read("server/middleware/requestLogger.ts");
const bandwidth = read("server/middleware/bandwidthDebug.ts");
const bandwidthTests = read("server/middleware/bandwidthDebug.test.ts");
const runtime = read("server/runtimeObservability.mjs");
const auditScript = read("scripts/audit-production-logs.mjs");
const auditDoc = read("docs/archive/observability/render-log-readability-phases-1-5.md");

requireText(logger, "process.env.LOG_LEVEL", "shared logger must support LOG_LEVEL");
requireText(logger, "process.env.LOG_FORMAT", "shared logger must support LOG_FORMAT");
requireText(logger, "isDev || isRender ? \"pretty\" : \"json\"", "Render must default to readable output");
requireText(logger, "humanizeLegacyMessage", "shared logger must provide legacy message humanisation");
requireText(logger, "createScopedLogger", "shared logger must provide scoped module logging");
requireText(logger, "globalThis as unknown as { __erpLogger?", "shared logger must register the bootstrap bridge");
requireText(logger, "resolveEffectiveLevel", "shared logger must provide a central noise policy");
requireText(logger, "[getLocationInventory", "inventory reads must be classified centrally");
requireText(logger, "[SLOW API]", "legacy duplicate slow lines must be classified centrally");
requireText(logger, "Top endpoints:", "bandwidth summaries must include concise top endpoints");
requireText(logger, "warning threshold", "slow request sentences must explain their threshold");

requireText(runtime, "globalThis.__erpLogger", "runtime observability must use the shared logger bridge");
requireText(runtime, "RUNTIME_OBSERVABILITY_REQUEST_LOGS", "runtime request duplicates must be explicitly opt-in");
if (runtime.includes("console.log(JSON.stringify")) {
  failures.push("runtime observability must not emit ad-hoc JSON directly");
}

requireText(requestPolicy, "DEFAULT_SLOW_REQUEST_MS = 1_000", "normal APIs must use a 1 second threshold");
requireText(requestPolicy, "DEFAULT_PDF_SLOW_REQUEST_MS = 3_000", "PDF endpoints must use a 3 second threshold");
requireText(requestPolicy, "DEFAULT_WHATSAPP_SLOW_REQUEST_MS = 5_000", "WhatsApp endpoints must use a 5 second threshold");
requireText(requestPolicy, "DEFAULT_REPORT_EXPORT_SLOW_REQUEST_MS = 5_000", "report exports must use a 5 second threshold");
requireText(requestPolicy, "DEFAULT_BACKGROUND_JOB_SLOW_REQUEST_MS = 10_000", "background jobs must use a 10 second threshold");
requireText(requestLogger, '"/api/auth/me"', "expected auth checks must be excluded from normal production logging");
requireText(requestLogger, "getSlowRequestThresholdMs", "request logger must use endpoint-aware thresholds");
requireText(requestLogger, "thresholdClass", "slow request logs must include their timing class");
requireText(requestLogger, "getBandwidthDiagnosticSnapshot", "protected metrics must expose full bandwidth diagnostics");

requireText(bandwidth, "DEFAULT_LOG_TOP_N = 3", "Render bandwidth summaries must default to three endpoints");
requireText(bandwidth, "MAX_LOG_TOP_N = 5", "Render bandwidth summaries must be capped at five endpoints");
requireText(bandwidth, "getBandwidthDiagnosticSnapshot", "bandwidth middleware must retain a full diagnostic snapshot");
requireText(bandwidth, "DEFAULT_STATIC_THRESHOLD_BYTES = 2 * 1024 * 1024", "static assets must use a 2 MB warning threshold");
requireText(bandwidth, "DEFAULT_DOCUMENT_THRESHOLD_BYTES = 10 * 1024 * 1024", "documents must use a 10 MB warning threshold");
requireText(bandwidth, "apiAggregates.length === 0 && staticAggregates.length === 0", "empty bandwidth windows must be skipped");

requireText(auditScript, "Production log audit", "repeatable production log audit must exist");
requireText(auditScript, "directConsoleCalls", "audit must report direct console usage");
requireText(auditScript, "categories", "audit must classify log messages");
requireText(auditDoc, "Phase 1 — Audit and classification", "documentation must cover phase 1");
requireText(auditDoc, "Phase 2 — Shared logging service", "documentation must cover phase 2");
requireText(auditDoc, "Phase 3 — Plain-language compatibility layer", "documentation must cover phase 3");
requireText(auditDoc, "Phase 4 — Remove duplicate and noisy logs", "documentation must cover phase 4");
requireText(auditDoc, "Phase 5 — Improve performance and bandwidth logging", "documentation must cover phase 5");

requireText(loggerTests, "moves routine inventory and lifecycle starts to DEBUG", "logger tests must cover phase 4 noise control");
requireText(loggerTests, "top endpoints", "logger tests must cover concise bandwidth summaries");
requireText(requestPolicyTests, "1s, 3s, 5s and 10s", "request policy tests must cover phase 5 thresholds");
requireText(bandwidthTests, "normal PDF, WhatsApp or export payload sizes", "bandwidth tests must protect normal document sizes");

if (failures.length > 0) {
  console.error("Readable production logging phases 1-5 verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Readable production logging phases 1-5 verified.");
console.log("This static check does not replace TypeScript, unit, build or production smoke testing.");
