import fs from "node:fs";

const required = {
  "server/lib/logAlertDispatcher.ts": [
    "dispatchOperationalAlert",
    "LOG_ALERTS_ENABLED",
    "LOG_ALERT_WEBHOOK_URL",
    "LOG_ALERT_COOLDOWN_MS",
    "LOG_ALERT_MIN_SEVERITY",
  ],
  "server/lib/operationalEvents.ts": ["dispatchOperationalAlert", "event.severity !== \"info\""],
  "server/routes/auth/activityOverviewRoutes.ts": [
    "/api/audit-log/overview",
    "requireExportAccess(\"exp_audit_log\")",
    "eq(auditLog.companyId, companyId)",
    "getOperationalEventSnapshot",
  ],
  "server/routes/authRoutes.ts": ["registerActivityOverviewRoutes"],
  "docs/archive/logging-phases-8-9.md": ["Phase 8", "Phase 9", "No schema migration"],
};

const failures = [];
for (const [file, tokens] of Object.entries(required)) {
  if (!fs.existsSync(file)) {
    failures.push(`${file} is missing`);
    continue;
  }
  const text = fs.readFileSync(file, "utf8");
  for (const token of tokens) {
    if (!text.includes(token)) failures.push(`${file} is missing ${token}`);
  }
}

if (failures.length) {
  console.error("Readable logging phases 8-9 verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Readable logging phases 8-9 contracts verified.");
