import fs from "node:fs";

const requiredFiles = [
  "server/lib/logger.ts",
  "server/middleware/requestLogger.ts",
  "server/lib/operationalEvents.ts",
  "server/middleware/bandwidthDebug.ts",
  "server/index.ts",
  "client/src/main.tsx",
  "docs/program-1-observability-roadmap.md",
];

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) {
    throw new Error(`Program 1 foundation missing required file: ${file}`);
  }
}

const logger = fs.readFileSync("server/lib/logger.ts", "utf8");
const requestLogger = fs.readFileSync("server/middleware/requestLogger.ts", "utf8");
const index = fs.readFileSync("server/index.ts", "utf8");
const clientMain = fs.readFileSync("client/src/main.tsx", "utf8");
const roadmap = fs.readFileSync("docs/program-1-observability-roadmap.md", "utf8");

const checks = [
  [logger.includes("SENSITIVE_KEY_PATTERN"), "server logger must redact sensitive keys"],
  [logger.includes("JSON.stringify(entry)"), "production logger must emit structured JSON"],
  [requestLogger.includes("X-Request-Id"), "request logger must return a correlation ID"],
  [requestLogger.includes("/api/health/metrics"), "monitoring metrics endpoint must remain available"],
  [requestLogger.includes("isMonitoringRole"), "metrics endpoint must remain role restricted"],
  [requestLogger.includes("recordOperationalEvent"), "HTTP failures must feed operational events"],
  [index.includes('process.on("unhandledRejection"'), "server must capture unhandled rejections"],
  [index.includes('process.on("uncaughtException"'), "server must capture uncaught exceptions"],
  [clientMain.includes('window.addEventListener("unhandledrejection"'), "client bootstrap must retain rejection handling"],
  [roadmap.includes("Never send request bodies"), "roadmap must preserve payload privacy boundary"],
  [roadmap.includes("Monitoring dependencies must fail open"), "roadmap must preserve fail-open behavior"],
];

for (const [passed, message] of checks) {
  if (!passed) throw new Error(`Program 1 foundation verification failed: ${message}`);
}

console.log("Program 1 observability foundation contract verified.");
