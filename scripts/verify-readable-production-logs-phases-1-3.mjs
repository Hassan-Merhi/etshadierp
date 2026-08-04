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
const runtime = read("server/runtimeObservability.mjs");
const auditScript = read("scripts/audit-production-logs.mjs");
const auditDoc = read("docs/observability/render-log-readability-phases-1-3.md");
const tests = read("server/lib/logger.test.ts");

requireText(logger, "process.env.LOG_LEVEL", "shared logger must support LOG_LEVEL");
requireText(logger, "process.env.LOG_FORMAT", "shared logger must support LOG_FORMAT");
requireText(logger, "isDev || isRender ? \"pretty\" : \"json\"", "Render must default to readable output");
requireText(logger, "humanizeLegacyMessage", "shared logger must provide legacy message humanisation");
requireText(logger, "createScopedLogger", "shared logger must provide scoped module logging");
requireText(logger, "globalThis as unknown as { __erpLogger?", "shared logger must register the bootstrap bridge");
requireText(logger, "Inventory loaded for location", "inventory messages must be readable");
requireText(logger, "WhatsApp uploaded", "WhatsApp messages must be readable");
requireText(logger, "API responses transferred", "bandwidth messages must be readable");
requireText(logger, "Access to ${path} was denied", "access-denied messages must be readable");

requireText(runtime, "globalThis.__erpLogger", "runtime observability must use the shared logger bridge");
requireText(runtime, "RUNTIME_OBSERVABILITY_REQUEST_LOGS", "runtime request duplicates must be explicitly opt-in");
if (runtime.includes("console.log(JSON.stringify")) {
  failures.push("runtime observability must not emit ad-hoc JSON directly");
}

requireText(auditScript, "Production log audit", "repeatable production log audit must exist");
requireText(auditScript, "directConsoleCalls", "audit must report direct console usage");
requireText(auditScript, "categories", "audit must classify log messages");
requireText(auditDoc, "Phase 1 — Audit and classification", "phase audit documentation must cover phase 1");
requireText(auditDoc, "Phase 2 — Shared logging service", "phase audit documentation must cover phase 2");
requireText(auditDoc, "Phase 3 — Plain-language compatibility layer", "phase audit documentation must cover phase 3");
requireText(tests, "converts inventory row logs into a sentence", "logger readability tests must cover inventory messages");
requireText(tests, "converts WhatsApp upload success into a sentence", "logger readability tests must cover WhatsApp messages");
requireText(tests, "summarises bandwidth reporting windows", "logger readability tests must cover bandwidth summaries");

if (failures.length > 0) {
  console.error("Readable production logging phases 1-3 verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Readable production logging phases 1-3 verified.");
console.log("This static check does not replace TypeScript, unit, build or production smoke testing.");
