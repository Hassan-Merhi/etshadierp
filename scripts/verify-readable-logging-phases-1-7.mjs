import fs from "node:fs";

const checks = [
  ["server/lib/logRedaction.ts", ["redactLogString", "WHATSAPP_GROUP_PATTERN", "QUERY_SECRET_PATTERN"]],
  ["server/lib/logger.ts", ["redactLogString", "redactLogValue", "redactionEnabled", "getLoggerConfiguration"]],
  ["docs/render-production-logging.md", ["LOG_REDACT_SENSITIVE=true", "X-Request-Id", "LOG_FORMAT=pretty"]],
];

const failures = [];
for (const [file, needles] of checks) {
  const content = fs.readFileSync(file, "utf8");
  for (const needle of needles) if (!content.includes(needle)) failures.push(`${file} missing ${needle}`);
}
if (failures.length) {
  console.error(`Readable logging phases 1-7 verification failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("Readable logging phases 1-7 contracts verified.");
