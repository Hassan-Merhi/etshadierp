import fs from "node:fs";

const requiredFiles = [
  "server/lib/logger.ts",
  "server/lib/logAlerts.ts",
  "server/lib/operationalEvents.ts",
  "server/routes/auth/auditLogRoutes.ts",
  "docs/render-readable-logging.md",
  "docs/logging-phases-8-9.md",
  "docs/logging-phase-10-release.md",
  "scripts/verify-readable-logging-phases-1-7.mjs",
  "scripts/verify-readable-logging-phases-8-9.mjs",
];

const failures = [];
for (const file of requiredFiles) {
  if (!fs.existsSync(file)) failures.push(`missing ${file}`);
}

function requireText(file, fragments) {
  if (!fs.existsSync(file)) return;
  const source = fs.readFileSync(file, "utf8");
  for (const fragment of fragments) {
    if (!source.includes(fragment)) failures.push(`${file} is missing ${JSON.stringify(fragment)}`);
  }
}

requireText("server/lib/logger.ts", [
  "LOG_REDACT_SENSITIVE",
  "getLoggerConfiguration",
  "requestId",
  "buildVersion",
]);
requireText("server/lib/logAlerts.ts", [
  "LOG_ALERTS_ENABLED",
  "LOG_ALERT_WEBHOOK_URL",
  "LOG_ALERT_MIN_SEVERITY",
  "LOG_ALERT_COOLDOWN_MS",
  "LOG_ALERT_TIMEOUT_MS",
]);
requireText("server/lib/operationalEvents.ts", ["dispatchOperationalAlert"]);
requireText("server/routes/auth/auditLogRoutes.ts", [
  '"/api/audit-log/overview"',
  "getLoggerConfiguration",
  "getLogAlertConfiguration",
  "getOperationalEventSnapshot",
]);
requireText("docs/logging-phase-10-release.md", [
  "Stage 1",
  "Stage 2",
  "Stage 3",
  "Rollback",
  "Post-deployment checks",
  "LOG_ALERTS_ENABLED=false",
]);

const workflowDirectory = ".github/workflows";
if (fs.existsSync(workflowDirectory)) {
  const temporary = fs
    .readdirSync(workflowDirectory)
    .filter((name) => /temp.*readable.*logging/i.test(name));
  if (temporary.length > 0) failures.push(`temporary readable-logging workflows remain: ${temporary.join(", ")}`);
}

if (failures.length > 0) {
  console.error("Readable logging phase 10 verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Readable production logging phases 1-10 release contracts verified.");
console.log("This static contract does not replace deployment smoke testing or production observation.");
