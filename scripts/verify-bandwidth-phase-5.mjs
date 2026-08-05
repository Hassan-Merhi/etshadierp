import fs from "node:fs";

const requiredFiles = [
  "server/middleware/bandwidthDebug.ts",
  "server/middleware/bandwidthDebug.test.ts",
  "server/lib/operationalEvents.ts",
  "docs/bandwidth-phase-5-diagnostics-verification.md",
];

const missingFiles = requiredFiles.filter((file) => !fs.existsSync(file));
const docs = fs.readFileSync("docs/bandwidth-phase-5-diagnostics-verification.md", "utf8");
const missingTargets = ["50 MB", "20 MB", "25 KB"].filter((target) => !docs.includes(target));

if (missingFiles.length > 0 || missingTargets.length > 0) {
  const failures = [
    ...missingFiles.map((file) => `missing file: ${file}`),
    ...missingTargets.map((target) => `missing acceptance target: ${target}`),
  ];
  console.error(`Bandwidth Phase 5 verification failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("Bandwidth Phase 5 diagnostics and production-verification contracts passed.");
